import { StorageBufferAttribute, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, globalId, texture, sampler } from 'three/tsl';
import { hitQueueStruct } from './structs.js';
import { proxy, proxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn } from '../../nodes/sampling.wgsl.js';
import { rngInit, rand1, rand2, rand3, RNG_INDEX_DIRECT_LIGHT_SELECTION, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_DIRECT_ENV_SAMPLE } from '../../nodes/random.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, isMISWeightLightFn } from '../../nodes/lights.wgsl.js';
import { lightRecordStruct } from '../../nodes/structs.wgsl.js';
import { transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';

export class LightConnectionKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },
			envInfo: { value: null },
			lightsInfo: { value: null },

			// settings
			misEnabled: uniform( 1, 'uint' ),
			filterGlossy: uniform( 1 ),

			// rays
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueStruct ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );
		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );

		// environment resources pulled straight off the envInfo provider ( EquirectHdrInfoNode )
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const randomLightSampleFn = proxyFn( 'lightsInfo.value.randomLightSample', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				misEnabled: u32,
				filterGlossy: f32,

				globalId: vec3u
			) -> void {

				let hitQueue = &${ params.hitQueue };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any invocations beyond the hit count
				let hitIndex = ( globalId.x + hitQueue.start );
				if ( hitIndex >= hitQueue.end ) {

					return;

				}

				// one-sample next event estimation selects between the analytic lights and the
				// environment. lightsDenom normalizes that selection: the light count, plus one
				// for the environment when it is active.
				let envActive = ${ envTotalSumNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var lightsDenom = f32( lightsCount );
				if ( envActive ) {

					lightsDenom += 1.0;

				}

				// nothing to do without any lights or an importance-sampleable environment
				if ( misEnabled == 0u || lightsDenom <= 0.0 ) {

					return;

				}

				let input = hitQueue.elements[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce );

				let objectInfo = transforms[ input.objectIndex ];
				var materialInfo = materials[ objectInfo.materialIndex ];

				// apply per-object colors
				materialInfo.color *= objectInfo.color.rgb;
				materialInfo.opacity *= objectInfo.color.a;

				let barycoord = vec3( input.barycoord, 1.0 - input.barycoord.x - input.barycoord.y );
				var vertexData = ${ sampleTrianglePointFn }( barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
				vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
				vertexData.position = objectInfo.matrixWorld * vertexData.position;

				// blur glossy surfaces after low-probability bounces, matching ProcessHits so the
				// NEE evaluation sees the same surface record
				let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

				let surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal, input.view, blurRoughness );

				// attenuate the light transmitted through the volume when exiting a backface so the
				// direct-light contribution matches the megakernel's ordering
				var throughputColor = input.throughputColor;
				if ( input.side < 0.0 && materialInfo.transmission > 0.0 ) {

					throughputColor *= ${ transmissionAttenuationFunc }( input.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

				}

				// next event estimation: draw one sample among the analytic lights and the
				// environment, MIS-weighted against the bsdf pdf.
				let selectRand = ${ rand1 }( ${ RNG_INDEX_DIRECT_LIGHT_SELECTION } );
				var lightRec: ${ lightRecordStruct };
				if ( envActive && selectRand >= f32( lightsCount ) / lightsDenom ) {

					// the environment, sampled from its CDF, as a light of kind ENVIRONMENT
					let envSample = ${ sampleEnvDir }( ${ rand2 }( ${ RNG_INDEX_DIRECT_ENV_SAMPLE } ) );
					lightRec.direction = envSample.direction;
					lightRec.emission = envSample.color;
					lightRec.pdf = envSample.pdf;
					lightRec.dist = ${ LIGHT_FAR_DISTANCE };
					lightRec.lightType = ${ ENVIRONMENT_LIGHT_TYPE };

				} else {

					lightRec = ${ randomLightSampleFn }( vertexData.position.xyz, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

				}

					// reject samples that fall below the geometric surface
					var lightPdf = lightRec.pdf;
					if ( dot( surface.faceNormal, lightRec.direction ) < 0.0 ) {

						lightPdf = 0.0;

					}

					if ( lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( input.view, lightRec.direction, surface );
						if ( evalRec.pdf > 0.0 ) {

							// TODO: is an offset needed here?
							var shadowRay: ${ rayStruct };
							shadowRay.origin = vertexData.position.xyz;
							shadowRay.direction = lightRec.direction;

							// opaque occlusion up to the light distance ( transmissive shadows not yet handled )
							var shadowHit: ${ raycastOutput };
							let occluded = ${ raycastFirstHitFn }( shadowRay, &shadowHit ) && shadowHit.dist < lightRec.dist - EPSILON;
							if ( ! occluded ) {

								lightPdf /= lightsDenom;

								// env + area lights are also bsdf-sampled, so MIS-weight them; punctual take full weight
								let misWeight = select( 1.0, ${ misHeuristicFn }( lightPdf, evalRec.pdf ), ${ isMISWeightLightFn }( lightRec.lightType ) );

								// deposit the contribution in place; ProcessHits reads this augmented resultColor
								hitQueue.elements[ hitIndex ].resultColor += vec4f( throughputColor * lightRec.emission * evalRec.color * misWeight / lightPdf, 0.0 );

							}

						}

					}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
