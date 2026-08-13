import { float } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, specularBtdfFunc, lambertBrdfFunc, fresnelMixFunc, conductorFresnelFunc, fresnelCoatFunc, iridescentFresnelFunc, thinWallTransmissionRoughnessFunc } from '../nodes/material.wgsl.js';
import { sheenColorFunc, sheenAlbedoScalingFunc } from '../nodes/sheen.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc, ggxRefractionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { rand1, rand2, RNG_INDEX_SCATTER_DIRECTION, RNG_INDEX_SCATTER_TYPE } from '../nodes/random.wgsl.js';
import { TurquinTexture } from '../TurquinTexture.js';
import { iorToF0Func, schlickFresnelFunc, schlickFresnelVecFunc, dielectricFresnelFunc } from '../nodes/utils.wgsl.js';

const CLEARCOAT_IOR = float( 1.5 );

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			specularBtdf = specularBtdfFunc,
			diffuseBrdf = lambertBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
			fresnelCoat = fresnelCoatFunc,
			iridescentFresnel = iridescentFresnelFunc,
		} = options;

		this.turquinTexture = new TurquinTexture();
		this.specularBrdf = specularBrdf;
		this.specularBtdf = specularBtdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel;
		this.fresnelCoat = fresnelCoat;
		this.iridescentFresnel = iridescentFresnel;

	}

	init( renderer ) {

		this.turquinTexture.generate( renderer );

	}

	getBsdfNode() {

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			// The material is organized as one scoped block per lobe in cascade order - clearcoat,
			// sheen, transmission ( glass ), specular, diffuse - each accumulating into a shared
			// result and guarding its own hemisphere.
			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				let NdotV = ctx.V.z;
				let NdotVc = ctx.Vc.z;
				let NdotL = ctx.L.z;

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				// Each lobe contributes into "result" within its own scope, evaluated in cascade
				// order. "attenuation" carries the fraction of energy each layer passes through to
				// the layers beneath it. Every lobe guards its own hemisphere, matching how Cycles
				// closures return zero for directions outside their domain.
				var result = vec3f( 0.0 );
				var attenuation = vec3f( 1.0 );

				// clearcoat
				{

					if ( NdotL > 0.0 ) {

						// reuse the same pattern for energy conservation used in the dielectric layer
						let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
						let clearcoatEnergySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotVc, surf.clearcoatRoughness ), 1e-5 );
						let clearcoatBoost = 1.0 + ${ iorToF0Func }( 1.5 ) * ( 1.0 - clearcoatEnergySS ) / clearcoatEnergySS;
						let clearcoatFresnelEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotVc, surf.clearcoatRoughness, 1.5 ) * clearcoatBoost;
						let clearcoatSpecular = ${ this.specularBrdf }( ctx.Vc, ctx.Lc, ctx.Hc, vec2( clearcoatAlpha ) ) * clearcoatBoost;
						let clearcoatFresnel = ${ schlickFresnelFunc }( abs( dot( ctx.Vc, ctx.Hc ) ), ${ iorToF0Func }( 1.5 ) );

						result += surf.clearcoat * clearcoatFresnel * clearcoatSpecular;
						attenuation *= 1.0 - surf.clearcoat * clearcoatFresnelEnergySS;

					}

				}

				// sheen
				{

					if ( NdotL > 0.0 ) {

						result += attenuation * surf.sheen * ${ sheenColorFunc }( ctx.V, ctx.L, ctx.H, surf );
						attenuation *= mix( 1.0, ${ sheenAlbedoScalingFunc }( ctx.V, ctx.L, surf ), surf.sheen );

					}

				}

				// transmission ( glass )
				// the full transmissive dielectric interface: fresnel reflection above the horizon
				// and refraction below it, so the specular lobe only serves the opaque remainder.
				// The refracted half is not attenuated by the layers above, matching the WebGL
				// implementation.
				{

					if ( surf.transmission > 0.0 ) {

						if ( NdotL < 0.0 ) {

							// TODO: transmitted light also crosses the thin film so it should be weighted by
							// the film-aware fresnel complement (1 - filmF) rather than the plain dielectric
							// fresnel, tinting transmission with the film's complementary color. Deferred until
							// the material is generalized into a layer stack that owns the fresnel per interface.
							var refraction: vec3f;
							if ( surf.thinWall ) {

								// evaluate the flipped reflection
								let wiMirror = vec3f( ctx.L.xy, - ctx.L.z );
								let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
								let F = ${ dielectricFresnelFunc }( saturate( ctx.VdotH ), surf.eta );
								refraction = ( 1.0 - F ) * ${ this.specularBrdf }( ctx.V, wiMirror, ctx.H, thinWallAlpha );

							} else {

								refraction = ${ this.specularBtdf }( ctx.V, ctx.L, ctx.H, alpha, surf.eta );

							}

							result += ( 1.0 - surf.metalness ) * surf.transmission * refraction * surf.color;

						} else {

							// fresnel reflection of the glass interface, mirroring the dielectric half
							// of the specular lobe below
							// Sample the single scatter energy for specular at the given roughness.
							let energySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );
							let dielectricBoost = 1.0 + surf.f0 * ( 1.0 - energySS ) / energySS;
							let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
							let boostedSpecular = specular * dielectricBoost;

							// the media on either side of the film - air outside and the volume interior
							// as the base on front faces, swapped on back faces so TIR can take effect
							let outsideIor = select( surf.ior, 1.0, surf.frontFace );
							let filmBaseIor = select( 1.0, surf.ior, surf.frontFace );

							// KHR_materials_specular: fold the specular color and intensity into the dielectric f0
							let dielectricF0 = min( surf.f0 * surf.specularColor, vec3f( 1.0 ) );

							// front faces use schlick so the KHR_materials_specular tinted f0 applies - interior
							// hits use the exact dielectric fresnel since schlick cannot represent TIR
							var dielectricFr: vec3f;
							if ( surf.frontFace ) {

								dielectricFr = ${ schlickFresnelVecFunc }( ctx.VdotH, dielectricF0, vec3f( 1.0 ) );

							} else {

								dielectricFr = vec3f( ${ dielectricFresnelFunc }( abs( ctx.VdotH ), surf.eta ) );

							}

							// iridescence blending toward the film fresnel
							let dielectricFilmFresnel = ${ this.iridescentFresnel }( ctx.VdotH, vec3f( ${ iorToF0Func }( filmBaseIor ) ), surf.iridescenceIor, outsideIor, surf.iridescenceThickness );
							let glassSpecular = boostedSpecular * mix( surf.specularIntensity * dielectricFr, dielectricFilmFresnel, surf.iridescence );

							result += attenuation * ( 1.0 - surf.metalness ) * surf.transmission * glassSpecular;

						}

					}

				}

				// specular
				// the metallic and dielectric halves share the ggx lobe with their own fresnel.
				// Iridescence swaps each half's fresnel for the thin film response, matching how
				// Cycles folds the film into the closure fresnel rather than adding a layer.
				{

					if ( NdotL > 0.0 ) {

						// Sample the single scatter energy for specular at the given roughness.
						let energySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );
						let dielectricBoost = 1.0 + surf.f0 * ( 1.0 - energySS ) / energySS;
						let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
						let boostedSpecular = specular * dielectricBoost;

						// the media on either side of the film - air outside and the volume interior
						// as the base on front faces, swapped on back faces so TIR can take effect
						let outsideIor = select( surf.ior, 1.0, surf.frontFace );
						let filmBaseIor = select( 1.0, surf.ior, surf.frontFace );

						// metallic half with the multiscatter comp, iridescence blending toward the
						// film fresnel over the conductor response
						let metallicBoost = 1.0 + surf.color * ( 1.0 - energySS ) / energySS;
						let metallicSpecular = specular * metallicBoost;
						let metallicFilmFresnel = ${ this.iridescentFresnel }( ctx.VdotH, surf.color, surf.iridescenceIor, outsideIor, surf.iridescenceThickness );
						let metallicBase = ${ this.conductorFresnel }( ctx.VdotH, surf.color, metallicSpecular );
						let metallic = mix( metallicBase, metallicSpecular * metallicFilmFresnel, surf.iridescence );

						result += attenuation * surf.metalness * metallic;

						// KHR_materials_specular: fold the specular color and intensity into the dielectric f0
						let dielectricF0 = min( surf.f0 * surf.specularColor, vec3f( 1.0 ) );

						// front faces use schlick so the KHR_materials_specular tinted f0 applies - interior
						// hits use the exact dielectric fresnel since schlick cannot represent TIR
						// TODO: see if we can clean this up and make these branches more consistent
						var dielectricFr: vec3f;
						if ( surf.frontFace ) {

							dielectricFr = ${ schlickFresnelVecFunc }( ctx.VdotH, dielectricF0, vec3f( 1.0 ) );

						} else {

							dielectricFr = vec3f( ${ dielectricFresnelFunc }( abs( ctx.VdotH ), surf.eta ) );

						}

						// dielectric half, iridescence blending toward the film fresnel. Weighted by the
						// opaque share - the transmissive portion's reflection belongs to the glass lobe
						let dielectricFilmFresnel = ${ this.iridescentFresnel }( ctx.VdotH, vec3f( ${ iorToF0Func }( filmBaseIor ) ), surf.iridescenceIor, outsideIor, surf.iridescenceThickness );
						let dielectricSpecular = boostedSpecular * mix( surf.specularIntensity * dielectricFr, dielectricFilmFresnel, surf.iridescence );

						result += attenuation * ( 1.0 - surf.metalness ) * ( 1.0 - surf.transmission ) * dielectricSpecular;

						// Attenuate the layers below by the energy taken by the specular interface - the
						// fresnel-weighted single scatter energy with the multiscatter boost, or the film
						// fresnel when iridescent, using its strongest channel so the base is not tinted
						// with the film's inverse color. Only the dielectric half passes light downward.
						let fresnelEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotV, surf.roughness, surf.ior ) * dielectricBoost;
						let filmFresnelMax = max( max( dielectricFilmFresnel.r, dielectricFilmFresnel.g ), dielectricFilmFresnel.b );
						attenuation *= ( 1.0 - surf.metalness ) * mix( 1.0 - fresnelEnergySS, 1.0 - filmFresnelMax, surf.iridescence );

					}

				}

				// diffuse
				{

					if ( NdotL > 0.0 ) {

						// the dielectric base mixes diffuse with transmission - the transmissive half
						// is carried by the glass lobe above
						let reflection = ${ this.diffuseBrdf }( NdotV, NdotL, ctx.VdotH, surf );
						let diffuse = ( 1.0 - surf.transmission ) * reflection;

						result += attenuation * diffuse;

					}

				}

				return result;

			}

		`;

		return wgslTagFn/* wgsl */`

			fn bsdfSample( worldWo: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.pdf = 0.0;

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;

				let normalBasis = surf.normalBasis;
				let invBasis = surf.normalInvBasis;
				let clearcoatBasis = surf.clearcoatBasis;
				let invClearcoatBasis = surf.clearcoatInvBasis;

				let wo = normalize( invBasis * worldWo );
				let woClearcoat = normalize( invClearcoatBasis * worldWo );

				// lobe selection weights and cumulative bounds in cascade order:
				// clearcoat, specular, transmission ( glass ), diffuse
				let weights = ${ getLobeWeightsFunc }( wo, wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );
				let cdfClearcoat = weights.clearcoat;
				let cdfSpecular = cdfClearcoat + weights.specular;
				let cdfTransmission = cdfSpecular + weights.transmission;
				let cdfTotal = cdfTransmission + weights.diffuse;

				let r = ${ rand1 }( ${ RNG_INDEX_SCATTER_TYPE } ) * cdfTotal;

				let directionUV = ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } );
				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;
				var isTransmissive = false;

				if ( r <= cdfClearcoat ) { // clearcoat

					whClearcoat = ${ ggxDirectionFunc }( woClearcoat, vec2( clearcoatAlpha ), directionUV );
					wiClearcoat = - normalize( reflect( woClearcoat, whClearcoat ) );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdfSpecular ) { // specular

					wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );
					wi = - normalize( reflect( wo, wh ) );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdfTransmission ) { // transmission ( glass )

					isTransmissive = true;

					if ( surf.thinWall ) {

						// model the double refraction as a single reflection flipped through the surface
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						wh = ${ ggxDirectionFunc }( wo, thinWallAlpha, directionUV );
						wi = - normalize( reflect( wo, wh ) );
						wi = vec3f( wi.xy, - wi.z );

					} else {

						// sample the half vector first and select reflection or refraction by the
						// facet fresnel, matching Cycles - total internal reflection drives the
						// fresnel to 1 so TIR facets always reflect with a matching pdf
						wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );
						let F = ${ dielectricFresnelFunc }( dot( wo, wh ), surf.eta );
						let rFresnel = ( r - cdfSpecular ) / ( cdfTransmission - cdfSpecular );
						if ( rFresnel < F ) {

							wi = - normalize( reflect( wo, wh ) );
							isTransmissive = false;

						} else {

							wi = refract( - wo, wh, surf.eta );

						}

					}

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdfTotal ) { // diffuse

					wi = ${ diffuseDirectionFunc }( wo, directionUV );
					wh = normalize( wi + wo );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				}

				var ctx: ${ bxdfContextStruct };
				ctx.V = wo;
				ctx.L = wi;
				ctx.H = wh;

				ctx.VdotH = saturate( dot( wo, wh ) );

				ctx.Vc = woClearcoat;
				ctx.Lc = wiClearcoat;
				ctx.Hc = whClearcoat;

				// pdf mixture - every lobe that can produce the sampled direction contributes its
				// share, in the same cascade order as the eval blocks

				// clearcoat
				{

					if ( weights.clearcoat > 0.0 && wiClearcoat.z > 0.0 ) {

						result.pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( woClearcoat, whClearcoat, vec2( clearcoatAlpha ) );

					}

				}

				// specular
				{

					if ( weights.specular > 0.0 && wi.z > 0.0 ) {

						result.pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

					}

				}

				// transmission ( glass )
				{

					if ( weights.transmission > 0.0 ) {

						if ( surf.thinWall ) {

							if ( wi.z < 0.0 ) {

								// the flipped reflection shares the reflection pdf
								let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
								result.pdf += weights.transmission * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, thinWallAlpha );

							}

						} else {

							// the glass lobe selects reflection or refraction by the facet fresnel so
							// each side carries the corresponding share of the transmission pdf
							let F = ${ dielectricFresnelFunc }( dot( wo, wh ), surf.eta );
							if ( wi.z > 0.0 ) {

								result.pdf += weights.transmission * F * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

							} else {

								result.pdf += weights.transmission * ( 1.0 - F ) * ${ ggxRefractionAdjustedPDFFunc }( wo, wi, wh, alpha, surf.eta );

							}

						}

					}

				}

				// diffuse
				{

					if ( weights.diffuse > 0.0 ) {

						result.pdf += weights.diffuse * max( wi.z, 0.0 ) / PI;

					}

				}

				result.color = ${ bsdfEvalFunc }( ctx, surf ) * select( max( 0.0, wi.z ), abs( wi.z ), isTransmissive );
				result.direction = normalize( normalBasis * wi );
				result.isTransmissive = isTransmissive;

				// Flip the scattered ray through the surface if it lands on the wrong side of the
				// geometry due to the shading normal - reflected rays must leave above the surface
				// and transmitted rays below it
				let scatterNormal = surf.faceNormal * select( 1.0, - 1.0, isTransmissive );
				let geomDotDir = dot( result.direction, scatterNormal );
				if ( geomDotDir < 0.0 ) {

					result.direction = normalize( result.direction - 2.0 * geomDotDir * scatterNormal );

				}

				return result;

			}

		`;

	}

}
