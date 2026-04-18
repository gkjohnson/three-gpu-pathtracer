import { wgslFn, texture, sampler, textureStore, globalId } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, FloatType } from 'three/webgpu';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, conductorFresnelFunc, albedoIntegralMetallic } from '../nodes/material.wgsl';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl';
import { scatterRecordStruct } from '../nodes/structs.wgsl';
import { pcgRand } from '../nodes/random.wgsl';
import { ComputeKernel } from '../compute/ComputeKernel';

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		this.turquinTexture = new StorageTexture( 32, 32 );
		this.turquinTexture.format = RedFormat;
		this.turquinTexture.type = FloatType;
		this.turquinTexture.minFilter = LinearFilter;
		this.turquinTexture.magFilter = LinearFilter;

		const turquinNode = texture( this.turquinTexture ).setName( 'turquinTexture' );

		const {
			specularBrdf = specularBrdfFunc,
			diffuseBrdf = diffuseBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
		} = options;

		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel( turquinNode );

	}

	init( renderer ) {

		const turquinParams = {
			texture: textureStore( this.turquinTexture ).toWriteOnly(),
			globalId,
		};
		const turquinKernel = new ComputeKernel( albedoIntegralMetallic( turquinParams ), { workgroupSize: [ 16, 16, 1 ] } );

		renderer.compute( turquinKernel.kernel, [ 4, 4, 1 ] );

	}

	getBsdfNode() {

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( NdotL: f32, NdotV: f32, NdotH: f32, VdotH: f32, surf: SurfaceRecord ) -> vec3f {

				let alpha = surf.roughness * surf.roughness;

				let specular = ${ this.specularBrdf }( NdotL, NdotV, NdotH, alpha );

				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, VdotH, surf );

				let dielectric = ${ this.fresnelMix }( VdotH, surf.ior, diffuse, specular );

				let metallic = ${ this.conductorFresnel }( NdotV, VdotH, surf.color, specular, alpha );

				return mix( dielectric, metallic, surf.metalness );

			}

		`;

		return wgslFn( /* wgsl */ `

			fn bsdfSample( worldWo: vec3f, surf: SurfaceRecord ) -> ScatterRecord {

				let alpha = surf.roughness * surf.roughness;
				let normalBasis = surf.normalBasis;
				let invBasis = surf.normalInvBasis;
				let wo = normalize( invBasis * worldWo );

				let weights = getLobeWeights( wo, wo, vec3( 0, 0, 1 ), vec3( 0, 0, 1 ), surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = 0; // pdf.transmission + cdf.y;
				cdf.w = 0; // pdf.clearcoat + cdf.z;

				let r = pcgRand() * cdf.y;

				var wi: vec3f;
				var wh: vec3f;

				if ( r <= cdf.x ) { // diffuse

					wi = diffuseDirection( wo, surf );
					wh = normalize( wi + wo );

				} else if ( r <= cdf.y ) { // specular

					wh = ggxDirection( wo, vec2( alpha ), pcgRand2() );

					wi = - reflect( wo, wh );

				} else if ( r <= cdf.z ) { // transmission / refraction

					// NOT IMPLEMENTED

				} else if ( r <= cdf.w ) { // clearcoat

					// NOT IMPLEMENTED

				}

				let NdotV = max( wo.z, EPSILON );
				let NdotL = saturate( wi.z );
				let NdotH = saturate( wh.z );
				let VdotH = saturate( dot( wo, wh ) );

				var result: ScatterRecord;
				result.pdf = 0;

				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * wi.z / PI;

				}

				if ( weights.specular > 0.0 ) {

					result.pdf += weights.specular * ggxReflectionAdjustedPDF( NdotV, NdotH, alpha );

				}

				result.color = bsdfEval( NdotL, NdotV, NdotH, VdotH, surf );
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
		] );

	}

}
