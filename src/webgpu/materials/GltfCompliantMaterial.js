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

				let NdotV = wo.z;
				let NdotL = wi.z;
				let NdotH = wh.z;
				let VdotH = dot( wo, wh );

				let specular = ${ this.specularBrdf }( NdotL, NdotV, NdotH, alpha );

				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, VdotH, surf );

				let dielectric = ${ this.fresnelMix }( VdotH, surf.ior, diffuse, specular );

				let metallic = ${ this.conductorFresnel }( VdotH, surf.color, specular );

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

				// TODO: Handle wi.z <= 0 better
				var result: ScatterRecord;
				result.pdf = 0;

				if ( wi.z > 0.0 && weights.diffuse > 0.0 ) {
					result.pdf += weights.diffuse * wi.z / PI;
				}

				if ( wi.z > 0.0 && weights.specular > 0.0 ) {
					let D = ggxDistribution( wh.z, alpha );
					let incidentTheta = acos( wo.z );
					let G1 = ggxShadowMaskG1( incidentTheta, alpha );

					let specPdf = D * G1 * max( 0, dot( wo, wh ) ) / ( 4 * wo.z * dot( wo, wh ) );

					result.pdf += weights.specular * specPdf;
				}

				result.color = bsdfEval( wo, wi, wh, surf );
				result.color *= wi.z;
				result.direction = normalize( normalBasis * wi );

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
