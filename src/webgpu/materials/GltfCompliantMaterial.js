import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { PathtracingMaterial } from './PathtracingMaterial';
import { wgslFn } from 'three/tsl';
import { specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, conductorFresnelFunc } from '../nodes/gltfSampleMaterial.wgsl';
import { diffuseDirectionFunc, getLobeWeightsFunc, ggxPDFFunc, specularDirectionFunc } from '../nodes/sampling.wgsl';
import { scatterRecordStruct } from '../nodes/structs.wgsl';
import { pcgRand } from '../nodes/random.wgsl';

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			diffuseBrdf = diffuseBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
		} = options;

		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel;

	}

	getBsdfNode() {

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( wo: vec3f, wi: vec3f, wh: vec3f, surf: SurfaceRecord ) -> vec3f {

				let alpha = surf.roughness * surf.roughness;

				let VdotH = dot( wo, wh );
				let NdotL = wi.z;
				let NdotV = wo.z;
				let NdotH = wh.z;

				let specular = ${ this.specularBrdf }( NdotL, NdotV, NdotH, alpha );

				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, VdotH, surf );

				let dielectric = ${ this.fresnelMix }( VdotH, surf.ior, diffuse, specular );

				let metallic = ${ this.conductorFresnel }( VdotH, surf.color, specular );

				return metallic; // mix( dielectric, metallic, surf.metalness );

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

				var result: ScatterRecord;
				var wh: vec3f;

				if ( r <= cdf.x ) { // diffuse

					result.direction = diffuseDirection( wo, surf );
					// result.color = vec3f( 0, 1, 0 );
					wh = normalize( result.direction + wo );

				} else if ( r <= cdf.y ) { // specular

					wh = ggxDirection( wo, vec2( alpha ), pcgRand2() );
					result.direction = - reflect( wo, wh );
					// result.color = vec3f( 1, 0, 0 );
					// wh = normalize( result.direction + wo );

				} else if ( r <= cdf.z ) { // transmission / refraction

					// NOT IMPLEMENTED

				} else if ( r <= cdf.w ) { // clearcoat

					// NOT IMPLEMENTED

				}

				// result.pdf = 1;

				result.pdf = 0;
				result.pdf += weights.diffuse * result.direction.z / PI;

				var specPdf = 0.0;

				let D = ggxDistribution( wh.z, alpha );

				let incidentTheta = acos( wo.z );
				let G1 = ggxShadowMaskG1( incidentTheta, alpha );

				specPdf = D * G1 * max( 0, dot( wo, wh ) ) / ( 4 * wo.z * dot( wo, wh ) );

				result.pdf += weights.specular * specPdf;

				result.color = bsdfEval( wo, result.direction, wh, surf );
				result.color *= result.direction.z;
				result.direction = normalize( normalBasis * result.direction );

				return result;

			}

		`, [
			bsdfEvalFunc,
			ggxPDFFunc,
			diffuseDirectionFunc,
			specularDirectionFunc,
			scatterRecordStruct,
			getLobeWeightsFunc,
			pcgRand,
		] );

	}

}
