import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn, weightedAlphaBlendFn, luminanceFn } from '../../nodes/sampling.wgsl.js';
import { isTerminatingScatterFunc } from '../../nodes/utils.wgsl.js';
import {
	rngInit, rand1, rand2, rand3,
	RNG_INDEX_ENVIRONMENT_SAMPLE,
	RNG_INDEX_RUSSIAN_ROULETTE,
	RNG_INDEX_DIRECT_LIGHT_SELECTION,
	RNG_INDEX_DIRECT_LIGHT_SAMPLE,
	RNG_INDEX_DIRECT_ENV_SAMPLE,
} from '../../nodes/random.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, isMISWeightLightFn } from '../../nodes/lights.wgsl.js';
import { lightRecordStruct, scatterRecordStruct } from '../../nodes/structs.wgsl.js';
import { rayDataStruct, intersectionResultStruct } from './structs.js';

// Path logic over the persistent slot pool: resolves the previous frame's shadow and bounce trace
// results, accumulates emission and NEE / forward MIS contributions, terminates finished paths into
// the output, and samples the next NEE light for MaterialKernel. Touches no BVH data.
export class LogicKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			envInfo: { value: null },
			backgroundInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			misEnabled: uniform( 1, 'uint' ),
			bounces: uniform( 5, 'uint' ),

			rayData: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayIntersections: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),
			shadowRayIntersections: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		// environment + background resources pulled off their providers ( embedded functions )
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const randomLightSampleFn = proxyFn( 'lightsInfo.value.randomLightSample', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				misEnabled: u32,
				bounces: u32,

				globalId: vec3u
			) -> void {

				let rayData = &${ params.rayData };
				let rayIntersections = &${ params.rayIntersections };
				let shadowRayIntersections = &${ params.shadowRayIntersections };

				let index = globalId.x;
				if ( index >= arrayLength( rayData ) ) {

					return;

				}

				// skip slots that have never spawned a ray
				let input = rayData[ index ];
				if ( input.rayIntersectionIndex < 0 ) {

					return;

				}

				let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, input.seed, input.currentBounce );

				// one-sample NEE selection normalization ( lights + env ), matched with the megakernel
				let envActive = ${ envTotalSumNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var lightsDenom = f32( lightsCount );
				if ( envActive ) {

					lightsDenom += 1.0;

				}

				var resultColor = input.resultColor;
				var throughputColor = input.throughputColor;

				// resolve the previous surface's NEE shadow ray ( pre-scatter throughput )
				if ( input.shadowRayIntersectionIndex >= 0 && input.lightPdf > 0.0 ) {

					let shadowHit = shadowRayIntersections[ u32( input.shadowRayIntersectionIndex ) ];
					let occluded = shadowHit.objectIndex >= 0 && shadowHit.dist < input.lightDist - EPSILON;
					if ( ! occluded ) {

						// env + area lights are also bsdf-sampled, so MIS-weight them; punctual take full weight
						let misWeight = select( 1.0, ${ misHeuristicFn }( input.lightPdf, input.lightBsdfPdf ), ${ isMISWeightLightFn }( input.lightType ) );
						resultColor += vec4f( throughputColor * input.lightEmission * input.lightBsdf * misWeight / input.lightPdf, 0.0 );

					}

				}

				// emission gathered at the previous surface ( pre-scatter throughput )
				resultColor += vec4f( throughputColor * input.emission, 0.0 );

				// reconstruct the scatter record staged by MaterialKernel
				var scatterRec: ${ scatterRecordStruct };
				scatterRec.color = input.bsdf;
				scatterRec.pdf = input.pdf;

				var isTerminated = input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				// russian roulette after a few bounces, boosting survivors ( clamped to avoid fireflies )
				if ( ! isTerminated && input.currentBounce >= 3u ) {

					let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
					let rrProb = sqrt( saturate( ${ luminanceFn }( rrThroughput ) / max( ${ luminanceFn }( throughputColor ), 1e-4 ) ) );
					if ( ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

						isTerminated = true;

					} else {

						throughputColor *= min( 1.0 / rrProb, 20.0 );

					}

				}

				if ( ! isTerminated ) {

					// apply the scatter across the traced segment
					throughputColor *= scatterRec.color / scatterRec.pdf;

					let hitResult = rayIntersections[ u32( input.rayIntersectionIndex ) ];
					let didHit = hitResult.objectIndex >= 0;
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// forward MIS: a bsdf-sampled segment that lands on a ( non-occluded ) area light.
					// Only area lights can be hit this way; the camera segment is skipped.
					if ( misEnabled != 0u && input.currentBounce > 0u ) {

						for ( var li = 0u; li < lightsCount; li ++ ) {

							var lightRec: ${ lightRecordStruct };
							if ( ${ intersectLightAtIndexFn }( input.origin, input.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

								let lightPdf = lightRec.pdf / lightsDenom;
								let misWeight = ${ misHeuristicFn }( input.pdf, lightPdf );
								resultColor += vec4f( lightRec.emission * throughputColor * misWeight, 0.0 );

							}

						}

					}

					if ( didHit ) {

						// stage the hit for MaterialKernel
						rayData[ index ].barycoord = hitResult.barycoord;
						rayData[ index ].normal = hitResult.normal;
						rayData[ index ].side = hitResult.side;
						rayData[ index ].indices = hitResult.indices;
						rayData[ index ].objectIndex = hitResult.objectIndex;

						// next event estimation: pick one sample among the analytic lights plus the
						// environment ( env is the last "light" when active ), each with probability
						// 1 / lightsDenom. MaterialKernel evaluates the bsdf and enqueues the shadow ray.
						var lightPdf = 0.0;
						if ( misEnabled != 0u && lightsDenom > 0.0 ) {

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

								lightRec = ${ randomLightSampleFn }( hitResult.position, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

							}

							lightPdf = lightRec.pdf / lightsDenom;
							rayData[ index ].lightDirection = lightRec.direction;
							rayData[ index ].lightEmission = lightRec.emission;
							rayData[ index ].lightDist = lightRec.dist;
							rayData[ index ].lightType = lightRec.lightType;

						}

						rayData[ index ].lightPdf = lightPdf;

					} else {

						// the segment escaped the scene: gather the environment ( or the background for
						// camera segments ) and terminate
						let rng = ${ rand2 }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
						if ( input.currentBounce > 0u ) {

							var misWeight = 1.0;
							if ( misEnabled != 0u && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( input.direction ) / lightsDenom;
								misWeight = ${ misHeuristicFn }( input.pdf, envPdf );

							}

							resultColor += ${ sampleEnvColor }( input.direction, rng ) * vec4f( throughputColor * misWeight, 0.0 );

						} else {

							resultColor = ${ sampleBackground }( input.direction, rng );

						}

						isTerminated = true;

					}

				}

				if ( isTerminated ) {

					// blend the finished sample into the output and free the slot for a new camera ray
					let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

					rayData[ index ].objectIndex = - 1;

				} else {

					rayData[ index ].resultColor = resultColor;
					rayData[ index ].throughputColor = throughputColor;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
