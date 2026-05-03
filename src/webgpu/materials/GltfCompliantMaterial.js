import { texture, textureStore, globalId, float } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, TextureLoader, HalfFloatType } from 'three/webgpu';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, fresnelCoatFunc, conductorFresnelFunc, albedoIntegralMetallic } from '../nodes/material.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, lobeWeightsStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { SOBOL_INDEX_SCATTER_DIRECTION, SOBOL_INDEX_SCATTER_TYPE, sobolFuncs } from '../nodes/random.wgsl.js';
import { ComputeKernel } from '../compute/ComputeKernel';

const TURQUIN_METAL_URL = new URL( '../../textures/turquinMetal.png', import.meta.url ).toString();
const TURQUIN_METAL_TEXTURE = await new TextureLoader().loadAsync( TURQUIN_METAL_URL );

const CLEARCOAT_IOR = float( 1.5 );
const MIN_INCIDENT_COS = float( 1e-3 );

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			diffuseBrdf = diffuseBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
			fresnelCoat = fresnelCoatFunc,
			calculateTurquinTexture = false,
		} = options;

		if ( calculateTurquinTexture ) {

			this.turquinTexture = new StorageTexture( 32, 32 );
			this.turquinTexture.type = HalfFloatType;

		} else {

			this.turquinTexture = TURQUIN_METAL_TEXTURE;
			this.turquinTexture.flipY = false;

		}

		this.turquinTexture.format = RedFormat;
		this.turquinTexture.minFilter = LinearFilter;
		this.turquinTexture.magFilter = LinearFilter;

		const turquinNode = texture( this.turquinTexture ).setName( 'turquinTexture' );

		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel( turquinNode );
		this.fresnelCoat = fresnelCoat;
		this.calculateTurquinTexture = calculateTurquinTexture;

		this.pdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfPdfEval(
				ctx: ${ bxdfContextStruct }, weights: ${ lobeWeightsStruct }, surf: ${ surfaceRecordStruct }
			) -> f32 {

				var pdf = 0.0;

				if ( weights.diffuse > 0.0 ) {

					pdf += weights.diffuse * ctx.NdotL / PI;

				}

				if ( weights.specular > 0.0 && ctx.NdotL > 0.0 ) {

					pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( ctx.NdotV, ctx.NdotH, surf.roughness * surf.roughness );

				}

				if ( weights.clearcoat > 0.0 && ctx.LdotNc > 0.0 ) {

					pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( ctx.VdotNc, ctx.HdotNc, surf.clearcoatRoughness * surf.clearcoatRoughness );

				}

				return pdf;

			}

		`;

		this.bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				let alpha = surf.roughness * surf.roughness;

				let specular = ${ this.specularBrdf }( ctx.NdotL, ctx.NdotV, ctx.NdotH, alpha );
				let diffuse = ${ this.diffuseBrdf }( ctx.NdotV, ctx.NdotL, ctx.VdotH, surf );
				let dielectric = ${ this.fresnelMix }( ctx.VdotH, surf.ior, diffuse, specular );

				let metallic = ${ this.conductorFresnel }( ctx.NdotV, ctx.VdotH, surf.color, specular, alpha );

				let material = mix( dielectric, metallic, surf.metalness );

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
				let clearcoat = ${ this.specularBrdf }( ctx.LdotNc, ctx.VdotNc, ctx.HdotNc, clearcoatAlpha );

				let coatedMaterial = ${ this.fresnelCoat }( ctx.VdotNc, ${ CLEARCOAT_IOR }, material, clearcoat, surf.clearcoat );

				return coatedMaterial;

			}
		`;

	}

	init( renderer ) {

		if ( ! this.calculateTurquinTexture ) {

			return;

		}

		const turquinParams = {
			texture: textureStore( this.turquinTexture ).toWriteOnly(),
			globalId,
		};
		const turquinKernel = new ComputeKernel( albedoIntegralMetallic( turquinParams ), { workgroupSize: [ 16, 16, 1 ] } );

		renderer.compute( turquinKernel.kernel, [ 2, 2, 1 ] );

	}

	getBsdfSampleNode() {

		return wgslTagFn/* wgsl */`

			fn bsdfSample( worldWo: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				let alpha = surf.roughness * surf.roughness;
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

					return ${ scatterRecordStruct }();

				}

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = 0; // weights.transmission + cdf.z;

				let r = ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_SCATTER_TYPE } ) * cdf.z;

				let directionUv = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_SCATTER_DIRECTION } );
				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;

				if ( r <= cdf.x ) { // diffuse

					wi = ${ diffuseDirectionFunc }( wo, directionUv );
					wh = normalize( wi + wo );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.y ) { // specular

					wh = ${ ggxDirectionFunc }( wo, vec2( alpha ), directionUv );
					wi = - normalize( reflect( wo, wh ) );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.z ) { // clearcoat

					whClearcoat = ${ ggxDirectionFunc }( woClearcoat, vec2( clearcoatAlpha ), directionUv );
					wiClearcoat = - normalize( reflect( woClearcoat, whClearcoat ) );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdf.w ) { // transmission / refraction

					// NOT IMPLEMENTED

				}

				var ctx: ${ bxdfContextStruct };
				ctx.NdotV = max( wo.z, ${ MIN_INCIDENT_COS } );
				ctx.NdotL = max( wi.z, ${ MIN_INCIDENT_COS } );
				ctx.NdotH = saturate( wh.z );
				ctx.VdotH = saturate( dot( wo, wh ) );

				ctx.VdotNc = max( woClearcoat.z, ${ MIN_INCIDENT_COS } );
				ctx.LdotNc = max( wiClearcoat.z, ${ MIN_INCIDENT_COS } );
				ctx.HdotNc = saturate( whClearcoat.z );

				var result: ${ scatterRecordStruct };
				result.direction = normalize( normalBasis * wi );
				result.color = ${ this.bsdfEvalFunc }( ctx, surf );
				result.color *= ctx.NdotL; // Should this be only for reflected light?
				result.pdf = ${ this.pdfEvalFunc }( ctx, weights, surf );

				return result;

			}

		`;

	}

	getBsdfEvalScatterNode() {

		return wgslTagFn/* wgsl */`

			fn bsdfEvalScatter( worldWo: vec3f, worldWi: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				let invBasis = surf.normalInvBasis;
				let invClearcoatBasis = surf.clearcoatInvBasis;

				let wo = normalize( invBasis * worldWo );
				let woClearcoat = normalize( invClearcoatBasis * worldWo );

				// TODO: handle such intersections better;
				// Sometimes .z < 0.0 on a pretty round surface e.g. sphere
				// Disabling this condition leads to more fireflies on ClearCoatCarPaint example
				// This could also be fixed by offsetting rays by 1e-1
				// Also, this will be an invalid condition when transmission is implemented
				if ( wo.z < 0.0 || woClearcoat.z < 0.0 ) {

					return ${ scatterRecordStruct }();

				}

				let wi = normalize( invBasis * worldWi );
				let wiClearcoat = normalize( invClearcoatBasis * worldWi );

				let wh = normalize( wi + wo );
				let whClearcoat = normalize( wiClearcoat + woClearcoat );

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, wh, ${ CLEARCOAT_IOR }, surf );

				var ctx: ${ bxdfContextStruct };
				ctx.NdotV = max( wo.z, ${ MIN_INCIDENT_COS } );
				ctx.NdotL = max( wi.z, ${ MIN_INCIDENT_COS } );
				ctx.NdotH = saturate( wh.z );
				ctx.VdotH = saturate( dot( wo, wh ) );

				ctx.VdotNc = max( woClearcoat.z, ${ MIN_INCIDENT_COS } );
				ctx.LdotNc = max( wiClearcoat.z, ${ MIN_INCIDENT_COS } );
				ctx.HdotNc = saturate( whClearcoat.z );

				var result: ${ scatterRecordStruct };
				result.direction = worldWi;
				result.color = ${ this.bsdfEvalFunc }( ctx, surf );
				result.color *= ctx.NdotL; // Should this be only for reflected light?
				result.pdf = ${ this.pdfEvalFunc }( ctx, weights, surf );

				return result;

			}

		`;

	}

}
