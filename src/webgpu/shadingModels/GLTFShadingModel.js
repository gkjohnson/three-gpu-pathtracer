import { BackSide, FrontSide, DoubleSide, ColorManagement, Vector3 } from 'three/webgpu';
import { float } from 'three/tsl';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { ShadingModel } from './ShadingModel.js';
import { specularBrdfFunc, specularBtdfFunc, fresnelMixFunc, conductorFresnelFunc, fresnelCoatFunc, iridescentFresnelFunc, isMatchedIorFunc, thinWallTransmissionRoughnessFunc, transmissionFresnelFunc, getSurfaceRecordFunc, applyDispersionFunc, getHitOpacityFunc, getHitEmissionFunc } from '../nodes/material.wgsl.js';
import { getMaterialExtinctionFn } from '../nodes/medium.wgsl.js';
import { isAuxSurfaceFn } from '../nodes/auxiliary.wgsl.js';
import { eonBrdfFunc, eonDirectionFunc, eonPDFFunc } from '../nodes/eon.wgsl.js';
import { sheenColorFunc, sheenAlbedoScalingFunc } from '../nodes/sheen.wgsl.js';
import { getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc, ggxRefractionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import {
	bxdfContextStruct,
	hitRecordStruct,
	scatterRecordStruct,
	materialMediumStruct,
	materialStruct as gltfMaterialStruct,
	surfaceRecordStruct as gltfSurfaceRecordStruct,
} from '../nodes/structs.wgsl.js';
import { rand1, rand2, RNG_INDEX_SCATTER_DIRECTION, RNG_INDEX_SCATTER_TYPE } from '../nodes/random.wgsl.js';
import { ifFeature } from '../nodes/features.js';
import { TurquinTexture } from '../TurquinTexture.js';
import { iorToF0Func, schlickFresnelFunc, schlickFresnelVecFunc, dielectricFresnelFunc } from '../nodes/utils.wgsl.js';

const _emissive = /* @__PURE__ */ new Vector3();
const _luminanceCoefficients = /* @__PURE__ */ new Vector3();

const CLEARCOAT_IOR = float( 1.5 );
const SINGULAR_EVENT_SCALE = float( 1e6 );

export class GLTFShadingModel extends ShadingModel {

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
		this.transmissionFresnel = transmissionFresnelFunc( iridescentFresnel );

	}

	init( renderer ) {

		this.turquinTexture.generate( renderer );

	}

	dispose() {

		super.dispose();
		this.turquinTexture.dispose();

	}

	updateFunctions() {

		super.updateFunctions();

		const { structs, fns } = this;
		structs.material = gltfMaterialStruct;
		structs.surfaceRecord = gltfSurfaceRecordStruct;

		fns.getSurfaceRecord = getSurfaceRecordFunc( {
			materialStruct: structs.material,
			surfaceRecordStruct: structs.surfaceRecord,
			attributesStruct: contextProxy( 'bvhData.structs.attributes' ),
			getVertex: contextProxyFn( 'bvhData.fns.getVertex' ),
			objectsStorage: contextProxy( 'bvhData.storage.objects' ),
			sampleTexel: fns.sampleTexel,
			getTextureSize: fns.getTextureSize,
			getUvFromChannel: contextProxyFn( 'bvhData.fns.getUvFromChannel' ),
			getColor: contextProxyFn( 'bvhData.fns.getColor' ),
		} );

		const surfaceRecordStruct = structs.surfaceRecord;
		const bsdfEvalFunc = wgslTagFn/* wgsl */`

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

				${ ifFeature( 'CLEARCOAT' )/* wgsl */`
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
				` }

				// sheen
				if ( NdotL > 0.0 && surf.sheen > 0.0 ) {

					result += attenuation * surf.sheen * ${ sheenColorFunc }( ctx.V, ctx.L, ctx.H, surf );
					attenuation *= mix( 1.0, ${ sheenAlbedoScalingFunc }( ctx.V, ctx.L, surf ), surf.sheen );

				}

				// transmission
				// handles specular reflection and transmission
				if ( surf.transmission > 0.0 ) {

					let matchedIor = ${ isMatchedIorFunc }( surf.eta );

					// anisotropic roughness along tangent, bitangent
					let alphaB = surf.roughness * surf.roughness;
					let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
					let alpha = vec2( alphaT, alphaB );

					// multiscatter compensation, looked up at the RMS alpha as in the specular lobe below
					let compensationRoughness = sqrt( sqrt( 0.5 * dot( alpha, alpha ) ) );
					var glassBoost = 0.0;
					if ( matchedIor ) {

						glassBoost = 1.0;

					} else if ( surf.thinWall ) {

						// thin wall halves are reflection-shaped so each is compensated with the conductor albedo at its own roughness.
						glassBoost = 1.0 / max( ${ this.turquinTexture.sampleConductorFn }( NdotV, compensationRoughness ), 1e-5 );

					} else {

						// volumetric bsdf is scaled by its total reflected + refracted energy
						glassBoost = 1.0 / max( ${ this.turquinTexture.sampleTransmissiveFn }( NdotV, compensationRoughness, surf.ior, surf.frontFace ), 1e-5 );

					}

					let fresnelCosine = select( ctx.VdotH, NdotV, surf.thinWall );
					let fresnel = ${ this.transmissionFresnel }( fresnelCosine, surf );

					if ( NdotL < 0.0 ) {

						var refraction = vec3f( 0.0 );
						if ( surf.thinWall && ! matchedIor ) {

							// evaluate the flipped reflection, compensated at the remapped roughness
							let wiMirror = vec3f( ctx.L.xy, - ctx.L.z );
							let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
							let thinWallEnergySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, sqrt( thinWallAlpha.x ) ), 1e-5 );
							refraction = fresnel.transmittance * ${ this.specularBrdf }( ctx.V, wiMirror, ctx.H, thinWallAlpha ) / thinWallEnergySS;

						} else if ( ! matchedIor ) {

							// The default BTDF contains the plain dielectric Fresnel complement. Replace it
							// with the colored thin-film-aware coefficient shared by sampling and the PDF.
							let dielectricTransmittance = 1.0 - ${ dielectricFresnelFunc }( abs( ctx.VdotH ), surf.eta );
							if ( dielectricTransmittance > EPSILON ) {

								refraction = ${ this.specularBtdf }( ctx.V, ctx.L, ctx.H, alpha, surf.eta ) *
									fresnel.transmittance / dielectricTransmittance * glassBoost;

							}

						}

						// the refracted half is not attenuated by the layers above. A volume is entered and exited,
						// so each crossing takes the square root of the color, as in Cycles
						let transmissionTint = select( sqrt( surf.color ), surf.color, surf.thinWall );
						result += ( 1.0 - surf.metalness ) * surf.transmission * refraction * transmissionTint;

					} else {

						// the raw single scatter lobe scaled by the glass compensation boost rather
						// than the opaque dielectric boost
						let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
						let dielectricSpecular = specular * glassBoost;

						let reflection = dielectricSpecular * fresnel.reflectance;

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

					// Sample the single scatter energy for specular. Anisotropic lobes are looked up at the root mean square
					// of their projected alpha over the view azimuth, which is the base roughness when isotropic
					let compensationRoughness = sqrt( sqrt( 0.5 * dot( alpha, alpha ) ) );
					let energySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, compensationRoughness ), 1e-5 );
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

					// The energy the specular interface takes from the layers below, at the lobe's specular color
					// and intensity. The table holds the albedo at the ior's f0, and the Schlick albedo is linear
					// in f0, so the tinted albedo slides from it toward the conductor albedo at f0 = 1
					let iorEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotV, compensationRoughness, surf.ior );
					let tintedEnergySS = iorEnergySS + ( dielectricF0 - surf.f0 ) * ( energySS - iorEnergySS ) / ( 1.0 - surf.f0 );
					let fresnelEnergySS = surf.specularIntensity * tintedEnergySS * dielectricBoost;

					result += attenuation * mix( ( 1.0 - surf.transmission ) * dielectric, metallic, surf.metalness );
					attenuation *= ( 1.0 - surf.metalness ) * mix( 1.0 - fresnelEnergySS, vec3f( 1.0 - filmFresnelMax ), surf.iridescence );

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

		fns.bsdfSample = wgslTagFn/* wgsl */`

			fn bsdfSample( hit: ${ hitRecordStruct }, surf: ${ surfaceRecordStruct }, worldWo: vec3f ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.color = vec3f( 0.0 );
				result.isTransmissive = false;
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
				var isDeltaTransmission = false;
				var deltaTransmittance = vec3f( 1.0 );
				var deltaProbability = 1.0;
				var isDead = false;

				// without clearcoat the lobe chain starts at the specular lobe, so the gated "else" chains onto its "if"
				${ ifFeature( 'CLEARCOAT' )/* wgsl */`
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

					} else
				` } if ( lobeSample <= cdfSpecular ) {

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

					let fresnelCosine = select( dot( wo, wh ), wo.z, surf.thinWall );
					let fresnel = ${ this.transmissionFresnel }( fresnelCosine, surf );

					let fresnelSample = ( lobeSample - cdfSpecular ) / ( cdfTransmission - cdfSpecular );
					let doReflect = fresnelSample < fresnel.reflectProbability;
					if ( doReflect ) {

						wi = - normalize( reflect( wo, wh ) );

					} else if ( ${ isMatchedIorFunc }( surf.eta ) ) {

						// With no IOR boundary, rough transmission collapses to straight-through
						// delta transmission independent of the sampled microfacet.
						wi = - wo;
						wh = vec3f( 0.0, 0.0, 1.0 );
						isDeltaTransmission = true;
						deltaTransmittance = fresnel.transmittance;
						deltaProbability = 1.0 - fresnel.reflectProbability;

					} else if ( surf.thinWall ) {

						// model the double refraction as a single reflection flipped through the
						// surface at the remapped thin wall roughness
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						wh = ${ ggxDirectionFunc }( wo, thinWallAlpha, directionUV );
						wi = - normalize( reflect( wo, wh ) );
						wi = vec3f( wi.xy, - wi.z );

					} else {

						wi = refract( - wo, wh, surf.eta );

						// "refract" returns zero on total internal reflection, so reflect instead and let "isDead" drop it
						if ( dot( wi, wi ) == 0.0 ) {

							wi = - normalize( reflect( wo, wh ) );

						}

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

				let worldWi = normalize( surf.normalBasis * wi );
				if ( isDeltaTransmission ) {

					// Cycles represents a singular event with a large matching BSDF and PDF. Their
					// ratio preserves throughput while forward MIS correctly gives the event full weight.
					let transmissionTint = select( sqrt( surf.color ), surf.color, surf.thinWall );
					result.color = ( 1.0 - surf.metalness ) * surf.transmission * transmissionTint *
						deltaTransmittance * ${ SINGULAR_EVENT_SCALE };
					result.direction = worldWi;
					result.pdf = weights.transmission * deltaProbability * ${ SINGULAR_EVENT_SCALE };
					result.isTransmissive = dot( worldWi, surf.faceNormal ) < 0.0;

				} else {

					// evaluate the shared eval / pdf function for the sampled direction so the sample
					// and light-sampling paths can never disagree on color or pdf
					result = ${ fns.bsdfEvalPdf }( hit, surf, worldWo, worldWi );

				}

				// mismatched glass facets and reflection lobe samples that land below the
				// hemisphere carry no energy - their loss is refunded by the compensation tables
				let invalid = isDead || ( ! isTransmissionLobe && wi.z <= 0.0 );
				result.color *= select( 1.0, 0.0, invalid );

				return result;

			}

		`;

		// Evaluates the BSDF and its sampling pdf for an arbitrary light direction ( both world space ).
		// Used by next event estimation to weight a chosen light/environment direction. Shares the same
		// bsdfEval and lobe-mixture pdf as bsdfSample so MIS weights stay consistent.
		fns.bsdfEvalPdf = wgslTagFn/* wgsl */`

			fn bsdfEvalPdf( hit: ${ hitRecordStruct }, surf: ${ surfaceRecordStruct }, worldWo: vec3f, worldWi: vec3f ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.color = vec3f( 0.0 );
				result.isTransmissive = false;
				result.direction = worldWi;
				result.pdf = 0.0;

				let wo = normalize( surf.normalInvBasis * worldWo );
				let wi = normalize( surf.normalInvBasis * worldWi );
				let woClearcoat = normalize( surf.clearcoatInvBasis * worldWo );

				let isTransmission = wi.z < 0.0;
				if ( isTransmission && ${ isMatchedIorFunc }( surf.eta ) ) {

					// Delta transmission has no finite solid-angle BSDF or PDF. It is handled
					// explicitly by bsdfSample, matching PBRT-v4's eta == 1 path.
					return result;

				}

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

				${ ifFeature( 'CLEARCOAT' )/* wgsl */`
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
				` }

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
					let fresnelCosine = select( dot( wo, wh ), wo.z, surf.thinWall );
					let fresnel = ${ this.transmissionFresnel }( fresnelCosine, surf );

					if ( wi.z > 0.0 ) {

						result.pdf += weights.transmission * fresnel.reflectProbability * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

					} else if ( surf.thinWall ) {

						// the flipped reflection shares the reflection pdf at the remapped roughness
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						result.pdf += weights.transmission * ( 1.0 - fresnel.reflectProbability ) * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, thinWallAlpha );

					} else {

						result.pdf += weights.transmission * ( 1.0 - fresnel.reflectProbability ) * ${ ggxRefractionAdjustedPDFFunc }( wo, wi, wh, alpha, surf.eta );

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

		fns.getHitOpacity = getHitOpacityFunc;
		fns.getHitEmission = getHitEmissionFunc;

		const materials = contextProxy( 'shadingModel.storage.materials' );
		fns.getMaterialMedium = wgslTagFn/* wgsl */`

			fn getMaterialMedium( materialIndex: u32 ) -> ${ materialMediumStruct } {

				let material = &${ materials }[ materialIndex ];
				var medium: ${ materialMediumStruct };
				medium.extinction = ${ getMaterialExtinctionFn }( material.attenuationColor, material.attenuationDistance );
				medium.fogVolume = material.fogVolume != 0;
				medium.multiscatterColor = material.multiscatterColor;
				medium.scatterStrength = material.scatterStrength;
				medium.scatterAnisotropy = material.scatterAnisotropy;
				medium.volume = medium.fogVolume || ( material.transmission > 0.0 && material.thinWall == 0 );
				return medium;

			}

		`;

		fns.applyDispersion = applyDispersionFunc;
		fns.isAuxSurface = isAuxSurfaceFn;

		// whether the surface renders transparent to the camera
		fns.isMatte = wgslTagFn/* wgsl */`

			fn isMatte( surf: ${ surfaceRecordStruct } ) -> bool {

				return surf.matte;

			}

		`;

	}

	/**
	 * Returns the material's field, or the default when it has none. For use in "writeMaterialsBuffer".
	 */
	getField( material, key, def ) {

		return key in material ? material[ key ] : def;

	}

	/**
	 * Returns whether the material is a volume: fog, or transmissive and not thin walled.
	 */
	isVolumeMaterial( material ) {

		const isFogVolume = Boolean( material.isFogVolumeMaterial );
		const isThinWall = this.getField( material, 'thickness', 0.0 ) === 0.0 && this.getField( material, 'attenuationDistance', Infinity ) === Infinity;
		return ( ! isThinWall && material.transmission > 0.0 ) || isFogVolume;

	}

	detectFeatures( material, features ) {

		if ( material.isFogVolumeMaterial ) {

			features.setUsed( 'FOG' );

		}

		if ( this.getField( material, 'clearcoat', 0.0 ) > 0.0 ) {

			features.setUsed( 'CLEARCOAT' );

		}

	}

	// the emissive color and intensity, ignoring the emissive map. Fog boundaries don't emit
	getEmissiveLuminance( material ) {

		if ( ! material || ! material.emissive || material.isFogVolumeMaterial ) {

			return 0;

		}

		ColorManagement.getLuminanceCoefficients( _luminanceCoefficients );
		return _emissive.setFromColor( material.emissive ).dot( _luminanceCoefficients ) * this.getField( material, 'emissiveIntensity', 1 );

	}

	writeMaterialsBuffer( materials ) {

		let index = 0;

		// NOTE: make the minimum material buffer length 2 in order to avoid TSL converting it to a scalar
		// TODO: remove this when fixed in three
		const materialBufferLength = Math.max( materials.length, 2 );
		const floatArray = new Float32Array( materialBufferLength * this.structs.material.proxyNode.getLength() );
		const intArray = new Int32Array( floatArray.buffer );

		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];
			const isFogVolume = Boolean( m.isFogVolumeMaterial );

			// color - offset 0
			// materials without a color, like NodeMaterial or ShaderMaterial, default to white
			if ( 'color' in m ) {

				floatArray[ index ++ ] = m.color.r;
				floatArray[ index ++ ] = m.color.g;
				floatArray[ index ++ ] = m.color.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			intArray[ index ++ ] = this.getTextureDescriptor( m, 'map' );

			// metalness & roughness - offset 4
			floatArray[ index ++ ] = this.getField( m, 'metalness', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'metalnessMap' );
			floatArray[ index ++ ] = this.getField( m, 'roughness', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'roughnessMap' );

			// transmission & emissiveIntensity - offset 8
			// three.js assumes a default f0 of 0.04 if no ior is provided which equates to an ior of 1.5
			floatArray[ index ++ ] = this.getField( m, 'ior', 1.5 );
			floatArray[ index ++ ] = this.getField( m, 'transmission', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'transmissionMap' );
			floatArray[ index ++ ] = this.getField( m, 'emissiveIntensity', 0.0 );

			// emission - offset 12
			if ( 'emissive' in m ) {

				floatArray[ index ++ ] = m.emissive.r;
				floatArray[ index ++ ] = m.emissive.g;
				floatArray[ index ++ ] = m.emissive.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			intArray[ index ++ ] = this.getTextureDescriptor( m, 'emissiveMap' );

			// normals - offset 16
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'normalMap' );
			index ++; // because of vec2 alignment
			if ( 'normalScale' in m ) {

				floatArray[ index ++ ] = m.normalScale.x;
				floatArray[ index ++ ] = m.normalScale.y;

			} else {

				floatArray[ index ++ ] = 1;
				floatArray[ index ++ ] = 1;

			}

			// clearcoat - offset 20
			floatArray[ index ++ ] = this.getField( m, 'clearcoat', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'clearcoatMap' );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'clearcoatNormalMap' );
			index ++; // because of vec2 alignment

			// offset 24
			if ( 'clearcoatNormalScale' in m ) {

				floatArray[ index ++ ] = m.clearcoatNormalScale.x;
				floatArray[ index ++ ] = m.clearcoatNormalScale.y;

			} else {

				floatArray[ index ++ ] = 1;
				floatArray[ index ++ ] = 1;

			}

			floatArray[ index ++ ] = this.getField( m, 'clearcoatRoughness', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'clearcoatRoughnessMap' );

			// iridescence - offset 28
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'iridescenceMap' );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'iridescenceThicknessMap' );

			floatArray[ index ++ ] = this.getField( m, 'iridescence', 0.0 );
			floatArray[ index ++ ] = this.getField( m, 'iridescenceIOR', 1.3 );

			// offset 32
			floatArray[ index ++ ] = this.getField( m, 'iridescenceThicknessMinimum', 100 );
			floatArray[ index ++ ] = this.getField( m, 'iridescenceThicknessMaximum', 400 );
			floatArray[ index ++ ] = this.getField( m, 'diffuseRoughness', 0.0 );
			floatArray[ index ++ ] = this.getField( m, 'dispersion', 0.0 );

			// specular color - offset 36
			if ( 'specularColor' in m ) {

				floatArray[ index ++ ] = m.specularColor.r;
				floatArray[ index ++ ] = m.specularColor.g;
				floatArray[ index ++ ] = m.specularColor.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			intArray[ index ++ ] = this.getTextureDescriptor( m, 'specularColorMap' );

			// specular intensity - offset 40
			floatArray[ index ++ ] = this.getField( m, 'specularIntensity', 1.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'specularIntensityMap' );

			// isThinWall
			const isThinWall = this.getField( m, 'thickness', 0.0 ) === 0.0 && this.getField( m, 'attenuationDistance', Infinity ) === Infinity;
			intArray[ index ++ ] = Number( isThinWall );
			index ++;

			// attenuation - offset 44. A fog volume's "density" is its extinction per unit length. The kernels derive
			// extinction as "- log( attenuationColor ) / attenuationDistance", so a color of e^-1 and a distance of
			// 1 / density give the density back
			if ( isFogVolume ) {

				floatArray[ index ++ ] = Math.exp( - 1 );
				floatArray[ index ++ ] = Math.exp( - 1 );
				floatArray[ index ++ ] = Math.exp( - 1 );

			} else if ( 'attenuationColor' in m ) {

				floatArray[ index ++ ] = m.attenuationColor.r;
				floatArray[ index ++ ] = m.attenuationColor.g;
				floatArray[ index ++ ] = m.attenuationColor.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			if ( isFogVolume ) {

				floatArray[ index ++ ] = m.density > 0 ? 1 / m.density : Infinity;

			} else {

				floatArray[ index ++ ] = this.getField( m, 'attenuationDistance', Infinity );

			}

			// alphaMap - offset 48
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'alphaMap' );
			intArray[ index ++ ] = Number( this.getField( m, 'castShadow', true ) ); // shadow
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;

			// side & matte - offset 52. Volumes are entered and left through both faces
			if ( this.isVolumeMaterial( m ) ) {

				floatArray[ index ++ ] = 0;

			} else {

				switch ( m.side ) {

					case FrontSide:
						floatArray[ index ++ ] = 1;
						break;
					case BackSide:
						floatArray[ index ++ ] = - 1;
						break;
					case DoubleSide:
						floatArray[ index ++ ] = 0;
						break;

				}

			}

			intArray[ index ++ ] = Number( this.getField( m, 'matte', false ) ); // matte
			floatArray[ index ++ ] = this.getField( m, 'sheen', 0.0 );
			index ++; // vec3 alignment requirements

			// sheenColor - offset 56
			if ( 'sheenColor' in m ) {

				floatArray[ index ++ ] = m.sheenColor.r;
				floatArray[ index ++ ] = m.sheenColor.g;
				floatArray[ index ++ ] = m.sheenColor.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			intArray[ index ++ ] = this.getTextureDescriptor( m, 'sheenColorMap' );

			// sheenRoughness, flags - offset 60
			floatArray[ index ++ ] = this.getField( m, 'sheenRoughness', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'sheenRoughnessMap' );

			intArray[ index ++ ] = Number( m.vertexColors );
			intArray[ index ++ ] = Number( m.flatShading );

			// transparent, fogVolume - offset 64
			intArray[ index ++ ] = Number( m.transparent );
			intArray[ index ++ ] = Number( isFogVolume );

			// anisotropy, anisotropyRotation, anisotropyMap - offset 66
			floatArray[ index ++ ] = this.getField( m, 'anisotropy', 0.0 );
			floatArray[ index ++ ] = this.getField( m, 'anisotropyRotation', 0.0 );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'anisotropyMap' );

			// bumpMap, bumpScale - offset 69
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'bumpMap' );
			floatArray[ index ++ ] = this.getField( m, 'bumpScale', 1.0 );
			index ++; // padding for mat3 alignment

			// map transform - offset 72
			index += this.writeTextureMatrixToArray( m, 'map', floatArray, index );

			// metalnessMap transform - offset 84
			index += this.writeTextureMatrixToArray( m, 'metalnessMap', floatArray, index );

			// roughnessMap transform - offset 96
			index += this.writeTextureMatrixToArray( m, 'roughnessMap', floatArray, index );

			// transmissionMap transform - offset 108
			index += this.writeTextureMatrixToArray( m, 'transmissionMap', floatArray, index );

			// emissiveMap transform - offset 120
			index += this.writeTextureMatrixToArray( m, 'emissiveMap', floatArray, index );

			// normalMap transform - offset 132
			index += this.writeTextureMatrixToArray( m, 'normalMap', floatArray, index );

			// clearcoatMap transform - offset 144
			index += this.writeTextureMatrixToArray( m, 'clearcoatMap', floatArray, index );

			// clearcoatNormalMap transform - offset 156
			index += this.writeTextureMatrixToArray( m, 'clearcoatNormalMap', floatArray, index );

			// clearcoatRoughnessMap transform - offset 168
			index += this.writeTextureMatrixToArray( m, 'clearcoatRoughnessMap', floatArray, index );

			// sheenColorMap transform - offset 180
			index += this.writeTextureMatrixToArray( m, 'sheenColorMap', floatArray, index );

			// sheenRoughnessMap transform - offset 192
			index += this.writeTextureMatrixToArray( m, 'sheenRoughnessMap', floatArray, index );

			// iridescenceMap transform - offset 204
			index += this.writeTextureMatrixToArray( m, 'iridescenceMap', floatArray, index );

			// iridescenceThicknessMap transform - offset 216
			index += this.writeTextureMatrixToArray( m, 'iridescenceThicknessMap', floatArray, index );

			// specularColorMap transform - offset 228
			index += this.writeTextureMatrixToArray( m, 'specularColorMap', floatArray, index );

			// specularIntensityMap transform - offset 240
			index += this.writeTextureMatrixToArray( m, 'specularIntensityMap', floatArray, index );

			// alphaMap transform - offset 252
			index += this.writeTextureMatrixToArray( m, 'alphaMap', floatArray, index );

			// anisotropyMap transform - offset 264
			index += this.writeTextureMatrixToArray( m, 'anisotropyMap', floatArray, index );

			// bumpMap transform - offset 276
			index += this.writeTextureMatrixToArray( m, 'bumpMap', floatArray, index );

			// scattering volume - offset 288. A fog volume's color is its single scatter albedo, used as is
			const multiscatterColor = isFogVolume ? m.color : this.getField( m, 'multiscatterColor', null );
			floatArray[ index ++ ] = multiscatterColor ? multiscatterColor.r : 1.0;
			floatArray[ index ++ ] = multiscatterColor ? multiscatterColor.g : 1.0;
			floatArray[ index ++ ] = multiscatterColor ? multiscatterColor.b : 1.0;
			floatArray[ index ++ ] = this.getField( m, 'scatterStrength', 0.0 );
			floatArray[ index ++ ] = this.getField( m, 'scatterAnisotropy', 0.0 );

			// padding to the struct's 16 byte alignment
			index += 3;

		}

		return { materialData: intArray };

	}

}
