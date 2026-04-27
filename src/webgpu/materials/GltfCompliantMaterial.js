import { texture, textureStore, globalId, float } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, FloatType, TextureLoader } from 'three/webgpu';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, conductorFresnelFunc, albedoIntegralMetallic, fresnelCoatFunc } from '../nodes/material.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { pcgRand, pcgRand2 } from '../nodes/random.wgsl.js';
import { ComputeKernel } from '../compute/ComputeKernel';

const TURQUIN_METAL_URL = new URL( '../../textures/turquinMetal.png', import.meta.url ).toString();
const TURQUIN_METAL_TEXTURE = await new TextureLoader().loadAsync( TURQUIN_METAL_URL );

const CLEARCOAT_IOR = float( 1.5 );
const EPSILON = float( 1e-3 );

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

		} else {

			this.turquinTexture = TURQUIN_METAL_TEXTURE;
			this.turquinTexture.flipY = false;

		}

		this.turquinTexture.format = RedFormat;
		this.turquinTexture.type = FloatType;
		this.turquinTexture.minFilter = LinearFilter;
		this.turquinTexture.magFilter = LinearFilter;

		const turquinNode = texture( this.turquinTexture ).setName( 'turquinTexture' );

		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel( turquinNode );
		this.fresnelCoat = fresnelCoat;
		this.calculateTurquinTexture = calculateTurquinTexture;

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

	getBsdfNode() {

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval(
				NdotL: f32, NdotV: f32, NdotH: f32, VdotH: f32,
				LdotNc: f32, VdotNc: f32, HdotNc: f32,
				surf: SurfaceRecord
			) -> vec3f {

				let alpha = surf.roughness * surf.roughness;

				let specular = ${ this.specularBrdf }( NdotL, NdotV, NdotH, alpha );
				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, VdotH, surf );
				let dielectric = ${ this.fresnelMix }( VdotH, surf.ior, diffuse, specular );

				let metallic = ${ this.conductorFresnel }( NdotV, VdotH, surf.color, specular, alpha );

				let material = mix( dielectric, metallic, surf.metalness );

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
				let clearcoat = ${ this.specularBrdf }( LdotNc, VdotNc, HdotNc, clearcoatAlpha );

				let coatedMaterial = ${ this.fresnelCoat }( VdotNc, ${ CLEARCOAT_IOR }, material, clearcoat, surf.clearcoat );

				return coatedMaterial;

			}

		`;

		return wgslTagFn/* wgsl */`

			fn bsdfSample( worldWo: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.pdf = 0.0;

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

					return result;

				}

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = 0; // weights.transmission + cdf.z;

				let r = ${ pcgRand }() * cdf.z;

				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;

				if ( r <= cdf.x ) { // diffuse

					wi = ${ diffuseDirectionFunc }( wo, surf );
					wh = normalize( wi + wo );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.y ) { // specular

					wh = ${ ggxDirectionFunc }( wo, vec2( alpha ), ${ pcgRand2 }() );
					wi = - reflect( wo, wh );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.z ) { // clearcoat

					whClearcoat = ${ ggxDirectionFunc }( woClearcoat, vec2( clearcoatAlpha ), ${ pcgRand2 }() );
					wiClearcoat = - reflect( woClearcoat, whClearcoat );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdf.w ) { // transmission / refraction

					// NOT IMPLEMENTED

				}

				let NdotV = max( wo.z, ${ EPSILON } );
				let NdotL = max( wi.z, ${ EPSILON } );
				let NdotH = saturate( wh.z );
				let VdotH = saturate( dot( wo, wh ) );

				let VdotNc = max( woClearcoat.z, ${ EPSILON } );
				let LdotNc = max( wiClearcoat.z, ${ EPSILON } );
				let HdotNc = saturate( whClearcoat.z );

				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * max( wi.z, 0.0 ) / PI;

				}

				if ( weights.specular > 0.0 && wi.z > 0.0 ) {

					result.pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( NdotV, NdotH, alpha );

				}

				if ( weights.clearcoat > 0.0 && wiClearcoat.z > 0.0 ) {

					result.pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( VdotNc, HdotNc, clearcoatAlpha );

				}

				result.color = ${ bsdfEvalFunc }(
					NdotL, NdotV, NdotH, VdotH,
					LdotNc, VdotNc, HdotNc,
					surf
				);
				result.color *= max( 0.0, wi.z );
				result.direction = normalize( normalBasis * wi );

				return result;

			}

		`;

	}

}
