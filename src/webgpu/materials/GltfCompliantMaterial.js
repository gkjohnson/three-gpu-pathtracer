import { texture, textureStore, globalId, float } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, TextureLoader, HalfFloatType } from 'three/webgpu';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { PathtracingMaterial } from './PathtracingMaterial';
import {
	specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, fresnelCoatFunc,
	conductorFresnelFunc, albedoIntegralMetallic, iridescentDielectricLayerFunc,
	iridescentConductorLayerFunc, specularBtdfFunc,
} from '../nodes/material.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc, ggxRefractionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, lobeWeightsStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { SOBOL_INDEX_SCATTER_DIRECTION, SOBOL_INDEX_SCATTER_TYPE, sobolFuncs } from '../nodes/random.wgsl.js';
import { ComputeKernel } from '../compute/ComputeKernel';
import { absMaxFunc } from '../nodes/utils.wgsl.js';

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
			specularBtdf = specularBtdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
			fresnelCoat = fresnelCoatFunc,
			iridescentDielectricLayer = iridescentDielectricLayerFunc,
			iridescentConductorLayer = iridescentConductorLayerFunc,
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
		this.specularBtdf = specularBtdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel( turquinNode );
		this.fresnelCoat = fresnelCoat;
		this.iridescentDielectricLayer = iridescentDielectricLayer;
		this.iridescentConductorLayer = iridescentConductorLayer;
		this.calculateTurquinTexture = calculateTurquinTexture;

		this.pdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfPdfEval(
				ctx: ${ bxdfContextStruct }, weights: ${ lobeWeightsStruct }, surf: ${ surfaceRecordStruct }
			) -> f32 {

				var pdf = 0.0;

				let isReflection = ctx.NdotL * ctx.NdotV > 0.0;

				if ( weights.diffuse > 0.0 && isReflection ) {

					pdf += weights.diffuse * abs( ctx.NdotL ) / PI;

				}

				if ( weights.specular > 0.0 && isReflection ) {

					pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( ctx.NdotV, ctx.NdotH, surf.roughness * surf.roughness );

				}

				if ( weights.clearcoat > 0.0 && isReflection ) {

					pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( ctx.NdotVc, ctx.NdotHc, surf.clearcoatRoughness * surf.clearcoatRoughness );

				}

				if ( weights.transmission > 0.0 && !isReflection ) {

					pdf += weights.transmission * ${ ggxRefractionAdjustedPDFFunc }( ctx.NdotV, ctx.HdotV, ctx.HdotL, ctx.NdotH, surf.eta, surf.roughness * surf.roughness );

				}

				return pdf;

			}

		`;

		this.bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				let alpha = surf.roughness * surf.roughness;

				let specular = ${ this.specularBrdf }( ctx.NdotL, ctx.HdotL, ctx.NdotV, ctx.HdotV, ctx.NdotH, alpha );

				let reflection = ${ this.diffuseBrdf }( ctx.NdotV, ctx.HdotV, ctx.NdotL, ctx.HdotL, surf );
				let refraction = ${ this.specularBtdf }( ctx.NdotL, ctx.HdotL, ctx.NdotV, ctx.HdotV, ctx.NdotH, alpha, surf.eta, surf.ior );
				let diffuse = mix( reflection, refraction * surf.color, surf.transmission );

				let dielectricBase = ${ this.fresnelMix }( abs( ctx.HdotV ), surf.ior, diffuse, specular );

				let dielectric = ${ this.iridescentDielectricLayer }(
					dielectricBase, diffuse, specular, abs( ctx.HdotV ), /* outsideIor */ 1.0,
					surf.ior, surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				let metallicBase = ${ this.conductorFresnel }( abs( ctx.NdotV ), abs( ctx.HdotV ), surf.color, specular, alpha );

				let metallic = ${ this.iridescentConductorLayer }(
					metallicBase, specular, surf.color, abs( ctx.HdotV ), /* outsideIor */ 1.0,
					surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				let material = mix( dielectric, metallic, surf.metalness );

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
				let clearcoat = ${ this.specularBrdf }( ctx.NdotLc, ctx.HdotLc, ctx.NdotVc, ctx.HdotVc, ctx.NdotHc, clearcoatAlpha );

				let coatedMaterial = ${ this.fresnelCoat }( abs( ctx.NdotVc ), ${ CLEARCOAT_IOR }, material, clearcoat, surf.clearcoat );

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

				// if ( wo.z < 0.0 ) {
				// 	return ${ scatterRecordStruct }( vec3f( 1.0, 0.0, 0.0 ), 1.0, wo, 1.0 );
				// }

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = weights.transmission + cdf.z;

				let r = ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_SCATTER_TYPE } ) * cdf.w;

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
					wiClearcoat = - reflect( woClearcoat, whClearcoat );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdf.w ) { // transmission / refraction

					wh = ${ ggxDirectionFunc }( wo, vec2( alpha ), directionUv );
					wi = refract( - wo, wh, surf.eta );

					// Total internal reflection case
					// TODO: handle better
					if ( wi.x == 0.0 && wi.y == 0.0 && wi.z == 0.0 ) {
						return ${ scatterRecordStruct }( );
					}

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				}

				var ctx: ${ bxdfContextStruct };
				ctx.NdotV = ${ absMaxFunc }( clamp( wo.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotL = ${ absMaxFunc }( clamp( wi.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotH = saturate( wh.z );
				ctx.HdotV = clamp( dot( wo, wh ), -1.0, 1.0 );
				ctx.HdotL = clamp( dot( wi, wh ), -1.0, 1.0 );

				ctx.NdotVc = ${ absMaxFunc }( clamp( woClearcoat.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotLc = ${ absMaxFunc }( clamp( wiClearcoat.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotHc = saturate( whClearcoat.z );
				ctx.HdotVc = clamp( dot( woClearcoat, whClearcoat ), -1.0, 1.0 );
				ctx.HdotLc = clamp( dot( wiClearcoat, whClearcoat ), -1.0, 1.0 );

				var result: ${ scatterRecordStruct };
				result.direction = normalize( normalBasis * wi );
				result.color = ${ this.bsdfEvalFunc }( ctx, surf );
				result.color *= abs( ctx.NdotL );
				result.pdf = ${ this.pdfEvalFunc }( ctx, weights, surf );

				// if ( wo.z < 0.0 ) {
				// 	return ${ scatterRecordStruct }( result.color, 0.0, worldWo, result.pdf );
				// }

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

				let wi = normalize( invBasis * worldWi );
				let wiClearcoat = normalize( invClearcoatBasis * worldWi );

				let wh = normalize( wi + wo );
				let whClearcoat = normalize( wiClearcoat + woClearcoat );

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, wh, ${ CLEARCOAT_IOR }, surf );

				var ctx: ${ bxdfContextStruct };
				ctx.NdotV = ${ absMaxFunc }( clamp( wo.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotL = ${ absMaxFunc }( clamp( wi.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotH = saturate( wh.z );
				ctx.HdotV = clamp( dot( wo, wh ), -1.0, 1.0 );
				ctx.HdotL = clamp( dot( wi, wh ), -1.0, 1.0 );

				ctx.NdotVc = ${ absMaxFunc }( clamp( woClearcoat.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotLc = ${ absMaxFunc }( clamp( wiClearcoat.z, -1.0, 1.0 ), ${ MIN_INCIDENT_COS } );
				ctx.NdotHc = saturate( whClearcoat.z );
				ctx.HdotVc = clamp( dot( woClearcoat, whClearcoat ), -1.0, 1.0 );
				ctx.HdotLc = clamp( dot( wiClearcoat, whClearcoat ), -1.0, 1.0 );

				var result: ${ scatterRecordStruct };
				result.direction = worldWi;
				result.color = ${ this.bsdfEvalFunc }( ctx, surf );
				result.color *= abs( ctx.NdotL );
				result.pdf = ${ this.pdfEvalFunc }( ctx, weights, surf );

				return result;

			}

		`;

	}

}
