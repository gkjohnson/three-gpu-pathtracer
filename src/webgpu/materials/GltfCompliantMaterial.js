import { float } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, lambertBrdfFunc, fresnelMixFunc, conductorFresnelFunc, fresnelCoatFunc, iridescentDielectricLayerFunc, iridescentConductorLayerFunc } from '../nodes/material.wgsl.js';
import { sheenColorFunc, sheenAlbedoScalingFunc } from '../nodes/sheen.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { rand1, rand2, RNG_INDEX_SCATTER_DIRECTION, RNG_INDEX_SCATTER_TYPE } from '../nodes/random.wgsl.js';
import { TurquinTexture } from '../TurquinTexture.js';
import { iorToF0Func, schlickFresnelFunc, schlickFresnelVecFunc } from '../nodes/utils.wgsl.js';

const CLEARCOAT_IOR = float( 1.5 );

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			diffuseBrdf = lambertBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
			fresnelCoat = fresnelCoatFunc,
			iridescentDielectricLayer = iridescentDielectricLayerFunc,
			iridescentConductorLayer = iridescentConductorLayerFunc,
		} = options;

		this.turquinTexture = new TurquinTexture();
		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel;
		this.fresnelCoat = fresnelCoat;
		this.iridescentDielectricLayer = iridescentDielectricLayer;
		this.iridescentConductorLayer = iridescentConductorLayer;

	}

	init( renderer ) {

		this.turquinTexture.generate( renderer );

	}

	getBsdfNode() {

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				let NdotV = ctx.V.z;
				let NdotVc = ctx.Vc.z;
				let NdotL = ctx.L.z;

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				// Sample the single scatter energy for specular at the given roughness.
				let energySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );
				let dielectricBoost = 1.0 + ${ iorToF0Func }( 1.5 ) * ( 1.0 - energySS ) / energySS;

				// specular and diffuse components
				let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
				let boostedSpecular = specular * dielectricBoost;
				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, ctx.VdotH, surf );

				// Sample the single scatter energy, including fresnel, for the specular layer, boosting by the
				// compensation formula above to account for multi scatter. Attenuate the energy allocated for
				// diffuse by the remaining energy from specular single scatter.
				let fresnelEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotV, surf.roughness, 1.5 ) * dielectricBoost;
				let dielectricDiffuse = ( 1.0 - fresnelEnergySS ) * diffuse;

				// KHR_materials_specular: fold the specular color and intensity into the dielectric f0
				let dielectricF0 = min( ${ iorToF0Func }( 1.5 ) * surf.specularColor, vec3f( 1.0 ) );
				let dielectricSpecular = boostedSpecular * surf.specularIntensity * ${ schlickFresnelVecFunc }( ctx.VdotH, dielectricF0, vec3f( 1.0 ) );
				let dielectricBase = dielectricDiffuse + dielectricSpecular;

				let dielectric = ${ this.iridescentDielectricLayer }(
					dielectricBase, diffuse, boostedSpecular, ctx.VdotH, /* outsideIor */ 1.0,
					1.5, surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				// Fresnel-weighted specular with the multiscatter comp
				let metallicBoost = 1.0 + surf.color * ( 1.0 - energySS ) / energySS;
				let metallicSpecular = specular * metallicBoost;
				let metallicBase = ${ this.conductorFresnel }( ctx.VdotH, surf.color, metallicSpecular );
				let metallic = ${ this.iridescentConductorLayer }(
					metallicBase, metallicSpecular, surf.color, ctx.VdotH, /* outsideIor */ 1.0,
					surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				let baseMaterial = mix( dielectric, metallic, surf.metalness );

				// sheen
				let sheenScale = mix( 1.0, ${ sheenAlbedoScalingFunc }( ctx.V, ctx.L, surf ), surf.sheen );
				let material = baseMaterial * sheenScale + ${ sheenColorFunc }( ctx.V, ctx.L, ctx.H, surf ) * surf.sheen;

				// clearcoat
				// reuse the same pattern for energy conservation used in the dielectric layer
				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
				let clearcoatEnergySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotVc, surf.clearcoatRoughness ), 1e-5 );
				let clearcoatBoost = 1.0 + ${ iorToF0Func }( 1.5 ) * ( 1.0 - clearcoatEnergySS ) / clearcoatEnergySS;
				let clearcoatFresnelEnergySS = ${ this.turquinTexture.sampleDielectricFn }( NdotVc, surf.clearcoatRoughness, 1.5 ) * clearcoatBoost;

				let clearcoatSpecular = ${ this.specularBrdf }( ctx.Vc, ctx.Lc, ctx.Hc, vec2( clearcoatAlpha ) ) * clearcoatBoost;
				let clearcoatBase = ( 1.0 - clearcoatFresnelEnergySS ) * material;
				let coatedMaterial = clearcoatBase + clearcoatSpecular * ${ schlickFresnelFunc }( abs( dot( ctx.Vc, ctx.Hc ) ), ${ iorToF0Func }( 1.5 ) );

				return mix( material, coatedMaterial, surf.clearcoat );

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

				// TODO: handle such intersections better;
				// Sometimes .z < 0.0 on a pretty round surface e.g. sphere
				// Disabling this condition leads to more fireflies on ClearCoatCarPaint example
				// This could also be fixed by offsetting rays by 1e-1
				// Also, this will be an invalid condition when transmission is implemented
				if ( wo.z < 0.0 || woClearcoat.z < 0.0 ) {

					return result;

				}

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = 0; // weights.transmission + cdf.z;

				let r = ${ rand1 }( ${ RNG_INDEX_SCATTER_TYPE } ) * cdf.z;

				let directionUV = ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } );
				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;

				if ( r <= cdf.x ) { // diffuse

					wi = ${ diffuseDirectionFunc }( wo, directionUV );
					wh = normalize( wi + wo );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.y ) { // specular

					wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );
					wi = - normalize( reflect( wo, wh ) );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.z ) { // clearcoat

					whClearcoat = ${ ggxDirectionFunc }( woClearcoat, vec2( clearcoatAlpha ), directionUV );
					wiClearcoat = - normalize( reflect( woClearcoat, whClearcoat ) );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdf.w ) { // transmission / refraction

					// NOT IMPLEMENTED

				}

				var ctx: ${ bxdfContextStruct };
				ctx.V = wo;
				ctx.L = wi;
				ctx.H = wh;

				ctx.VdotH = saturate( dot( wo, wh ) );

				ctx.Vc = woClearcoat;
				ctx.Lc = wiClearcoat;
				ctx.Hc = whClearcoat;

				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * max( wi.z, 0.0 ) / PI;

				}

				if ( weights.specular > 0.0 && wi.z > 0.0 ) {

					result.pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

				}

				if ( weights.clearcoat > 0.0 && wiClearcoat.z > 0.0 ) {

					result.pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( woClearcoat, whClearcoat, vec2( clearcoatAlpha ) );

				}

				result.color = ${ bsdfEvalFunc }( ctx, surf );
				result.color *= max( 0.0, wi.z );
				result.direction = normalize( normalBasis * wi );

				return result;

			}

		`;

	}

}
