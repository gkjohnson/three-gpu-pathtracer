import { float } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, specularBtdfFunc, fresnelMixFunc, conductorFresnelFunc, fresnelCoatFunc, iridescentFresnelFunc, thinWallTransmissionRoughnessFunc } from '../nodes/material.wgsl.js';
import { eonBrdfFunc, eonDirectionFunc, eonPDFFunc } from '../nodes/eon.wgsl.js';
import { sheenColorFunc, sheenAlbedoScalingFunc } from '../nodes/sheen.wgsl.js';
import { getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
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
			diffuseBrdf = eonBrdfFunc,
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

		this._bsdfEvalFunc = wgslTagFn/* wgsl */`

			// The material is organized as one scoped block per lobe in cascade order - clearcoat,
			// sheen, transmission, specular, diffuse - each accumulating into a shared result and
			// guarding its own hemisphere.
			// TODO: energy only cascades downward through front faces, so the layers are always traversed
			// outside-in and cannot reflect energy back into the glass from below.
			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				let NdotV = ctx.V.z;
				let NdotL = ctx.L.z;

				// Each lobe contributes into "result" within its own scope, evaluated in cascade.
				// "attenuation" carries the fraction of energy each layer passes through to
				// the layers beneath it. Every lobe guards its own hemisphere.
				var result = vec3f( 0.0 );
				var attenuation = vec3f( 1.0 );

				// clearcoat
				if ( NdotL > 0.0 && surf.clearcoat > 0.0 ) {

					// the clearcoat evaluates in its own frame
					let toClearcoatMat = surf.clearcoatInvBasis * surf.normalBasis;
					let Vc = normalize( toClearcoatMat * ctx.V );
					let Lc = normalize( toClearcoatMat * ctx.L );
					let Hc = normalize( toClearcoatMat * ctx.H );
					let NdotVc = Vc.z;

					let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;

					// reuse the same pattern for energy conservation used in the dielectric layer
					let clearcoatEnergySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotVc, surf.clearcoatRoughness ), 1e-5 );
					let clearcoatBoost = 1.0 + ${ iorToF0Func }( 1.5 ) * ( 1.0 - clearcoatEnergySS ) / clearcoatEnergySS;

					let clearcoatSpecular = ${ this.specularBrdf }( Vc, Lc, Hc, vec2( clearcoatAlpha ) ) * clearcoatBoost;
					let clearcoatFresnel = ${ schlickFresnelFunc }( abs( dot( Vc, Hc ) ), ${ iorToF0Func }( 1.5 ) );

					// retrieve specular energy reflected by this layer
					let clearcoatFresnelEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotVc, surf.clearcoatRoughness, 1.5 ) * clearcoatBoost;

					result += surf.clearcoat * clearcoatFresnel * clearcoatSpecular;
					attenuation *= 1.0 - surf.clearcoat * clearcoatFresnelEnergySS;

				}

				// sheen
				if ( NdotL > 0.0 && surf.sheen > 0.0 ) {

					result += attenuation * surf.sheen * ${ sheenColorFunc }( ctx.V, ctx.L, ctx.H, surf );
					attenuation *= mix( 1.0, ${ sheenAlbedoScalingFunc }( ctx.V, ctx.L, surf ), surf.sheen );

				}

				// transmission
				// handles specular reflection and transmission
				if ( surf.transmission > 0.0 ) {

					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					// a thin wall has no interior volume so air is the incident medium on both
					// sides - only a true volume distinguishes entering from exiting hits
					let airIncident = surf.thinWall || surf.frontFace;

					// multiscatter compensation
					var glassBoost = 0.0;
					if ( surf.thinWall ) {

						// thin wall halves are reflection-shaped so each is compensated with the conductor albedo at its own roughness.
						glassBoost = 1.0 / max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );

					} else {

						// volumetric bsdf is scaled by its total reflected + refracted energy
						glassBoost = 1.0 / max( ${ this.turquinTexture.sampleTransmissiveFn }( NdotV, surf.roughness, surf.ior, surf.frontFace ), 1e-5 );

					}

					if ( NdotL < 0.0 ) {

						// TODO: transmitted light also crosses the iridescent thin film so it should be weighted by
						// the iridescence-aware fresnel complement rather than the plain dielectric fresnel
						var refraction: vec3f;
						if ( surf.thinWall ) {

							// evaluate the flipped reflection, compensated at the remapped roughness
							let wiMirror = vec3f( ctx.L.xy, - ctx.L.z );
							let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
							let thinWallEnergySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, sqrt( thinWallAlpha.x ) ), 1e-5 );
							let F = ${ dielectricFresnelFunc }( saturate( ctx.VdotH ), surf.eta );
							refraction = ( 1.0 - F ) * ${ this.specularBrdf }( ctx.V, wiMirror, ctx.H, thinWallAlpha ) / thinWallEnergySS;

						} else {

							refraction = ${ this.specularBtdf }( ctx.V, ctx.L, ctx.H, alpha, surf.eta ) * glassBoost;

						}

						// the refracted half is not attenuated by the layers above
						result += ( 1.0 - surf.metalness ) * surf.transmission * refraction * surf.color;

					} else {

						// the raw single scatter lobe scaled by the glass compensation boost rather
						// than the opaque dielectric boost
						let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
						let dielectricSpecular = specular * glassBoost;

						// KHR_materials_specular: fold the specular color and intensity into the dielectric f0
						let dielectricF0 = min( surf.f0 * surf.specularColor, vec3f( 1.0 ) );

						// air-incident hits use schlick so the tinted f0 applies - interior hits use
						// the exact fresnel since schlick cannot represent TIR
						// TODO: see if we can clean this up and make these branches more consistent
						var dielectricFr: vec3f;
						if ( airIncident ) {

							dielectricFr = ${ schlickFresnelVecFunc }( ctx.VdotH, dielectricF0, vec3f( 1.0 ) );

						} else {

							dielectricFr = vec3f( ${ dielectricFresnelFunc }( abs( ctx.VdotH ), surf.eta ) );

						}

						var dielectricReflectance = surf.specularIntensity * dielectricFr;

						// iridescence
						if ( surf.iridescence > 0.0 ) {

							// the media on either side of the film - air outside and the volume interior
							// as the base, swapped on interior hits so TIR can take effect
							let outsideIor = select( surf.ior, 1.0, airIncident );
							let filmBaseIor = select( 1.0, surf.ior, airIncident );

							let dielectricFilmFresnel = ${ this.iridescentFresnel }( ctx.VdotH, vec3f( ${ iorToF0Func }( filmBaseIor ) ), surf.iridescenceIor, outsideIor, surf.iridescenceThickness );
							dielectricReflectance = mix( dielectricReflectance, dielectricFilmFresnel, surf.iridescence );

						}

						let reflection = dielectricSpecular * dielectricReflectance;

						result += attenuation * ( 1.0 - surf.metalness ) * surf.transmission * reflection;

					}

				}

				// specular
				// metallic + dielectric + iridescence
				if ( NdotL > 0.0 ) {

					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					// Sample the single scatter energy for specular at the given roughness
					let energySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );
					let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );

					// metallic with the multiscatter comp
					let metallicBoost = 1.0 + surf.color * ( 1.0 - energySS ) / energySS;
					let metallicSpecular = specular * metallicBoost;
					var metallicReflectance = ${ this.conductorFresnel }( ctx.VdotH, surf.color, vec3f( 1.0 ) );

					// dielectric with the multiscatter comp
					let dielectricBoost = 1.0 + surf.f0 * ( 1.0 - energySS ) / energySS;
					let dielectricSpecular = specular * dielectricBoost;

					// KHR_materials_specular: fold the specular color and intensity into the dielectric f0.
					// Schlick is used on both hit sides, matching Cycles - the opaque specular carries no
					// TIR so the energy removed from the base always matches the energy paid back
					let dielectricF0 = min( surf.f0 * surf.specularColor, vec3f( 1.0 ) );
					let dielectricFr = ${ schlickFresnelVecFunc }( ctx.VdotH, dielectricF0, vec3f( 1.0 ) );
					var dielectricReflectance = surf.specularIntensity * dielectricFr;

					// iridescence
					var filmFresnelMax = 0.0;
					if ( surf.iridescence > 0.0 ) {

						// the media on either side of the film - air outside and the volume interior
						// as the base on front faces, swapped on back faces so TIR can take effect
						let outsideIor = select( surf.ior, 1.0, surf.frontFace );
						let filmBaseIor = select( 1.0, surf.ior, surf.frontFace );

						let metallicFilmFresnel = ${ this.iridescentFresnel }( ctx.VdotH, surf.color, surf.iridescenceIor, outsideIor, surf.iridescenceThickness );
						metallicReflectance = mix( metallicReflectance, metallicFilmFresnel, surf.iridescence );

						let dielectricFilmFresnel = ${ this.iridescentFresnel }( ctx.VdotH, vec3f( ${ iorToF0Func }( filmBaseIor ) ), surf.iridescenceIor, outsideIor, surf.iridescenceThickness );
						dielectricReflectance = mix( dielectricReflectance, dielectricFilmFresnel, surf.iridescence );
						filmFresnelMax = max( max( dielectricFilmFresnel.r, dielectricFilmFresnel.g ), dielectricFilmFresnel.b );

					}

					let metallic = metallicSpecular * metallicReflectance;
					let dielectric = dielectricSpecular * dielectricReflectance;

					// the energy the specular interface takes from the layers below
					let fresnelEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotV, surf.roughness, surf.ior ) * dielectricBoost;

					result += attenuation * mix( ( 1.0 - surf.transmission ) * dielectric, metallic, surf.metalness );
					attenuation *= ( 1.0 - surf.metalness ) * mix( 1.0 - fresnelEnergySS, 1.0 - filmFresnelMax, surf.iridescence );

				}

				// diffuse
				if ( NdotL > 0.0 ) {

					// the dielectric base mixes diffuse with transmission - the transmissive half
					// is carried by the glass lobe above
					let diffuseVdotH = sqrt( saturate( 0.5 * ( 1.0 + dot( ctx.V, ctx.L ) ) ) );
					let reflection = ${ this.diffuseBrdf }( NdotV, NdotL, diffuseVdotH, surf );
					let diffuse = ( 1.0 - surf.transmission ) * reflection;

					result += attenuation * diffuse;

				}

				return result;

			}

		`;

		const bsdfEvalPdfFn = this.getBsdfEvalPdfNode();

		return wgslTagFn/* wgsl */`

			fn bsdfSample( worldWo: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.color = vec3f( 0.0 );
				result.direction = vec3f( 0.0 );
				result.pdf = 0.0;

				let wo = normalize( surf.normalInvBasis * worldWo );
				let woClearcoat = normalize( surf.clearcoatInvBasis * worldWo );

				// TODO: mirror bsdfEval's layer structure - the glass layer should own both its
				// reflection and refraction halves
				// lobe selection weights and cumulative bounds in cascade order:
				// clearcoat, specular, transmission, diffuse
				let weights = ${ getLobeWeightsFunc }( wo, wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );
				let cdfClearcoat = weights.clearcoat;
				let cdfSpecular = cdfClearcoat + weights.specular;
				let cdfTransmission = cdfSpecular + weights.transmission;
				let cdfTotal = cdfTransmission + weights.diffuse;

				// random samples for lobes
				let lobeSample = ${ rand1 }( ${ RNG_INDEX_SCATTER_TYPE } ) * cdfTotal;
				let directionUV = ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } );

				// output
				var wi: vec3f;
				var wh: vec3f;

				// TODO: see if we can clean up these flags so they're not necessary
				var isTransmissionLobe = false;
				var isDead = false;

				if ( lobeSample <= cdfClearcoat ) {

					// clearcoat
					let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
					let whCoat = ${ ggxDirectionFunc }( woClearcoat, vec2( clearcoatAlpha ), directionUV );
					let wiCoat = - normalize( reflect( woClearcoat, whCoat ) );

					wi = normalize( surf.normalInvBasis * surf.clearcoatBasis * wiCoat );
					wh = normalize( surf.normalInvBasis * surf.clearcoatBasis * whCoat );

					// reflected rays must leave above the geometry surface - flip rays that land
					// below it due to the shading normal. Rays below the shading hemisphere are
					// left as is since their loss is refunded by the energy compensation tables
					let faceNormal = normalize( surf.normalInvBasis * surf.faceNormal );
					let geomDotDir = dot( wi, faceNormal );
					if ( wi.z > 0.0 && geomDotDir < 0.0 ) {

						wi = normalize( wi - 2.0 * geomDotDir * faceNormal );

					}

				} else if ( lobeSample <= cdfSpecular ) {

					// specular
					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );
					wi = - normalize( reflect( wo, wh ) );

					// reflected rays must leave above the geometry surface - flip rays that land
					// below it due to the shading normal. Rays below the shading hemisphere are
					// left as is since their loss is refunded by the energy compensation tables
					let faceNormal = normalize( surf.normalInvBasis * surf.faceNormal );
					let geomDotDir = dot( wi, faceNormal );
					if ( wi.z > 0.0 && geomDotDir < 0.0 ) {

						wi = normalize( wi - 2.0 * geomDotDir * faceNormal );

					}

				} else if ( lobeSample <= cdfTransmission ) {

					// transmission
					isTransmissionLobe = true;

					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					// sample the half vector first and select reflection or refraction by the
					// facet fresnel, matching Cycles - total internal reflection drives the
					// fresnel to 1 so TIR facets always reflect with a matching pdf
					wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );

					var F: f32;
					if ( surf.thinWall ) {

						F = ${ dielectricFresnelFunc }( wo.z, surf.eta );

					} else {

						F = ${ dielectricFresnelFunc }( dot( wo, wh ), surf.eta );

					}

					let fresnelSample = ( lobeSample - cdfSpecular ) / ( cdfTransmission - cdfSpecular );
					let doReflect = fresnelSample < F;
					if ( doReflect ) {

						wi = - normalize( reflect( wo, wh ) );

					} else if ( surf.thinWall ) {

						// model the double refraction as a single reflection flipped through the
						// surface at the remapped thin wall roughness
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						wh = ${ ggxDirectionFunc }( wo, thinWallAlpha, directionUV );
						wi = - normalize( reflect( wo, wh ) );
						wi = vec3f( wi.xy, - wi.z );

					} else {

						wi = refract( - wo, wh, surf.eta );

					}

					// the facet choice must agree with the resulting hemisphere - reflection above,
					// transmission below. Mismatched samples are dropped since their loss is
					// refunded by the energy compensation tables
					isDead = doReflect != ( wi.z > 0.0 );

				} else if ( lobeSample <= cdfTotal ) {

					// diffuse
					// all diffuse BRDF variants share the EON sampling proposal
					wi = ${ eonDirectionFunc }( wo, surf.diffuseRoughness, directionUV );
					wh = normalize( wi + wo );

					// reflected rays must leave above the geometry surface - flip rays that land
					// below it due to the shading normal. Rays below the shading hemisphere are
					// left as is since their loss is refunded by the energy compensation tables
					let faceNormal = normalize( surf.normalInvBasis * surf.faceNormal );
					let geomDotDir = dot( wi, faceNormal );
					if ( wi.z > 0.0 && geomDotDir < 0.0 ) {

						wi = normalize( wi - 2.0 * geomDotDir * faceNormal );

					}

				}

				// evaluate the shared eval / pdf function for the sampled direction so the sample
				// and light-sampling paths can never disagree on color or pdf
				result = ${ bsdfEvalPdfFn }( worldWo, normalize( surf.normalBasis * wi ), surf );

				// mismatched glass facets and reflection lobe samples that land below the
				// hemisphere carry no energy - their loss is refunded by the compensation tables
				let invalid = isDead || ( ! isTransmissionLobe && wi.z <= 0.0 );
				result.color *= select( 1.0, 0.0, invalid );

				return result;

			}

		`;

	}

	// Evaluates the BSDF and its sampling pdf for an arbitrary light direction ( both world space ).
	// Used by next event estimation to weight a chosen light/environment direction. Shares the same
	// bsdfEval and lobe-mixture pdf as bsdfSample so MIS weights stay consistent.
	getBsdfEvalPdfNode() {

		// bsdfSample embeds this node so both share a single instance
		if ( this._bsdfEvalPdfNode ) {

			return this._bsdfEvalPdfNode;

		}

		if ( ! this._bsdfEvalFunc ) {

			this.getBsdfNode();

		}

		const bsdfEvalFunc = this._bsdfEvalFunc;

		this._bsdfEvalPdfNode = wgslTagFn/* wgsl */`

			fn bsdfEvalPdf( worldWo: vec3f, worldWi: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.color = vec3f( 0.0 );
				result.direction = worldWi;
				result.pdf = 0.0;

				let wo = normalize( surf.normalInvBasis * worldWo );
				let wi = normalize( surf.normalInvBasis * worldWi );
				let woClearcoat = normalize( surf.clearcoatInvBasis * worldWo );

				let isTransmission = wi.z < 0.0;

				// reconstruct the half vector bsdfSample would have used for this direction -
				// reflections use the standard half vector while refractions use the generalized
				// form scaled by the ior ratio, oriented into the upper hemisphere
				var wh: vec3f;
				if ( ! isTransmission ) {

					wh = normalize( wo + wi );

				} else if ( surf.thinWall ) {

					// thin wall transmission is modeled as a reflection flipped through the surface
					wh = normalize( wo + vec3f( wi.xy, - wi.z ) );

				} else {

					wh = normalize( wi + wo * surf.eta );
					wh *= sign( wh.z );

				}

				let weights = ${ getLobeWeightsFunc }( wo, wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				// TODO: mirror bsdfEval's layer structure - the glass layer should own both its
				// reflection and refraction halves
				// pdf mixture - every lobe that can produce the direction contributes its share,
				// in the same cascade order and with the same terms as bsdfSample

				// clearcoat
				if ( weights.clearcoat > 0.0 ) {

					// the clearcoat lobe evaluates in its own frame
					let toClearcoatMat = surf.clearcoatInvBasis * surf.normalBasis;
					let wiClearcoat = normalize( toClearcoatMat * wi );
					if ( wiClearcoat.z > 0.0 ) {

						let whClearcoat = normalize( toClearcoatMat * wh );
						let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
						result.pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( woClearcoat, whClearcoat, vec2( clearcoatAlpha ) );

					}

				}

				// specular
				if ( weights.specular > 0.0 && wi.z > 0.0 ) {

					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					result.pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

				}

				// transmission
				if ( weights.transmission > 0.0 ) {

					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					// the glass lobe selects reflection or refraction by the facet fresnel so
					// each side carries the corresponding share of the transmission pdf
					var F: f32;
					if ( surf.thinWall ) {

						F = ${ dielectricFresnelFunc }( wo.z, surf.eta );

					} else {

						F = ${ dielectricFresnelFunc }( dot( wo, wh ), surf.eta );

					}

					if ( wi.z > 0.0 ) {

						result.pdf += weights.transmission * F * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

					} else if ( surf.thinWall ) {

						// the flipped reflection shares the reflection pdf at the remapped roughness
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						result.pdf += weights.transmission * ( 1.0 - F ) * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, thinWallAlpha );

					} else {

						result.pdf += weights.transmission * ( 1.0 - F ) * ${ ggxRefractionAdjustedPDFFunc }( wo, wi, wh, alpha, surf.eta );

					}

				}

				// diffuse
				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * ${ eonPDFFunc }( wo, wi, surf.diffuseRoughness );

				}

				//

				// construct the scatter context
				var ctx: ${ bxdfContextStruct };
				ctx.V = wo;
				ctx.L = wi;
				ctx.H = wh;
				ctx.VdotH = saturate( dot( wo, wh ) );

				// evaluate the bsdf for the direction
				result.color = ${ bsdfEvalFunc }( ctx, surf ) * abs( wi.z );

				// a direction crossing below the surface enters or leaves the volume
				result.isTransmissive = isTransmission && dot( worldWi, surf.faceNormal ) < 0.0;

				return result;

			}

		`;

		return this._bsdfEvalPdfNode;

	}

}
