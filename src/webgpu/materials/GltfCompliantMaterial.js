import { wgslFn, texture, textureStore, globalId } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, FloatType, TextureLoader } from 'three/webgpu';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, conductorFresnelFunc, albedoIntegralMetallic, fresnelCoatFunc } from '../nodes/material.wgsl';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl';
import { scatterRecordStruct } from '../nodes/structs.wgsl';
import { pcgRand, pcgRand2 } from '../nodes/random.wgsl';
import { ComputeKernel } from '../compute/ComputeKernel';

const TURQUIN_METAL_URL = new URL( '../../textures/turquinMetal.png', import.meta.url ).toString();
const TURQUIN_METAL_TEXTURE = await new TextureLoader().loadAsync( TURQUIN_METAL_URL );

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

				let coatedMaterial = ${ this.fresnelCoat }( VdotNc, 1.5, material, clearcoat, surf.clearcoat );

				return coatedMaterial;

			}

		`;

		return wgslFn( /* wgsl */ `

			fn bsdfSample( worldWo: vec3f, surf: SurfaceRecord ) -> ScatterRecord {

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

					var res: ScatterRecord;
					res.pdf = 0.0;
					return res;

				}

				let weights = getLobeWeights( wo, woClearcoat, vec3( 0, 0, 1 ), vec3( 0, 0, 1 ), surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = 0; // weights.transmission + cdf.z;

				let r = pcgRand() * cdf.z;

				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;

				if ( r <= cdf.x ) { // diffuse

					wi = diffuseDirection( wo, surf );
					wh = normalize( wi + wo );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.y ) { // specular

					wh = ggxDirection( wo, vec2( alpha ), pcgRand2() );
					wi = - reflect( wo, wh );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.z ) { // clearcoat

					whClearcoat = ggxDirection( woClearcoat, vec2( clearcoatAlpha ), pcgRand2() );
					wiClearcoat = - reflect( woClearcoat, whClearcoat );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdf.w ) { // transmission / refraction

					// NOT IMPLEMENTED

				}

				let NdotV = max( wo.z, EPSILON );
				let NdotL = max( wi.z, EPSILON );
				let NdotH = saturate( wh.z );
				let VdotH = saturate( dot( wo, wh ) );

				let VdotNc = max( woClearcoat.z, EPSILON );
				let LdotNc = max( wiClearcoat.z, EPSILON );
				let HdotNc = saturate( whClearcoat.z );

				var result: ScatterRecord;
				result.pdf = 0;

				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * max( wi.z, 0.0 ) / PI;

				}

				if ( weights.specular > 0.0 && wi.z > 0.0 ) {

					result.pdf += weights.specular * ggxReflectionAdjustedPDF( NdotV, NdotH, alpha );

				}

				if ( weights.clearcoat > 0.0 && wiClearcoat.z > 0.0 ) {

					result.pdf += weights.clearcoat * ggxReflectionAdjustedPDF( VdotNc, HdotNc, clearcoatAlpha );

				}

				result.color = bsdfEval(
					NdotL, NdotV, NdotH, VdotH,
					LdotNc, VdotNc, HdotNc,
					surf
				);
				result.color *= max( 0.0, wi.z );
				result.direction = normalize( normalBasis * wi );

				return result;

			}

		`, [
			bsdfEvalFunc,
			ggxReflectionAdjustedPDFFunc,
			ggxDirectionFunc,
			diffuseDirectionFunc,
			scatterRecordStruct,
			getLobeWeightsFunc,
			pcgRand,
			pcgRand2,
		] );

	}

}
