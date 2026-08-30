import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { clampPathContributionFunc, isTerminatingScatterFunc } from '../../nodes/utils.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../../constants.js';
import {
	rngInit, rand1, rand2, rand3,
	RNG_INDEX_BACKGROUND_SAMPLE,
	RNG_INDEX_RUSSIAN_ROULETTE,
	RNG_INDEX_DIRECT_LIGHT_SAMPLE,
} from '../../nodes/random.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, LIGHT_EPSILON, isMISWeightLightFn } from '../../nodes/lights.wgsl.js';
import { lightRecordStruct, scatterRecordStruct } from '../../nodes/structs.wgsl.js';
import { rayDataStruct, intersectionResultStruct } from './structs.js';
import { SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';

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
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),
			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),

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
				clampDirect: f32,
				clampIndirect: f32,
				transmissiveBackground: u32,

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
				${ rngInit }( indexUV, input.seed, input.currentBounce + input.alphaDepth );

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
					let occluded = shadowHit.objectIndex >= 0 && shadowHit.dist < input.lightDist - ${ LIGHT_EPSILON };
					if ( ! occluded ) {

						// env + area lights are also bsdf-sampled, so MIS-weight them; punctual take full weight
						let misWeight = select( 1.0, ${ misHeuristicFn }( input.lightPdf, input.lightBsdfPdf ), ${ isMISWeightLightFn }( input.lightType ) );
						let directLight = throughputColor * input.lightEmission * input.lightBsdf * misWeight / input.lightPdf;
						let contribution = ${ clampPathContributionFunc }( directLight, input.currentBounce + 1u, clampDirect, clampIndirect );
						resultColor += vec4f( contribution, 0.0 );

					}

				}

				// emission gathered at the previous surface ( pre-scatter throughput )
				let emission = ${ clampPathContributionFunc }( throughputColor * input.emission, input.currentBounce + 1u, clampDirect, clampIndirect );
				resultColor += vec4f( emission, 0.0 );

				// reconstruct the scatter record staged by MaterialKernel
				var scatterRec: ${ scatterRecordStruct };
				scatterRec.color = input.bsdf;
				scatterRec.pdf = input.pdf;

				var isTerminated = all( throughputColor == vec3f( 0.0 ) ) || input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				// russian roulette early out:
				// Matches Cycles path_state_continuation_probability in integrator/path_state.h
				if ( ! isTerminated && input.currentBounce >= 3u ) {

					let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
					let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
					isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
					if ( ! isTerminated ) {

						throughputColor /= rrProb;

					}

				}

				if ( ! isTerminated ) {

					// apply the scatter across the traced segment
					throughputColor *= scatterRec.color / scatterRec.pdf;

					let hitResult = rayIntersections[ u32( input.rayIntersectionIndex ) ];
					let didHit = hitResult.objectIndex >= 0;
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// forward hits: a bsdf-sampled segment that lands on a area light. MIS-weighted
					// only when NEE is also sampling the lights. The camera segment is skipped.
					if ( input.currentBounce > 0u ) {

						for ( var li = 0u; li < lightsCount; li ++ ) {

							var lightRec: ${ lightRecordStruct };
							if ( ${ intersectLightAtIndexFn }( input.origin, input.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

								var misWeight = 1.0;
								if ( misEnabled != 0u ) {

									let lightPdf = lightRec.pdf / lightsDenom;
									misWeight = ${ misHeuristicFn }( input.pdf, lightPdf );

								}

								let lightHit = ${ clampPathContributionFunc }( lightRec.emission * throughputColor * misWeight, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor += vec4f( lightHit, 0.0 );

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
						rayData[ index ].dist = hitResult.dist;

						// next event estimation: pick one light or the environment with a single sample.
						// MaterialKernel evaluates the bsdf and enqueues the shadow ray.
						// TODO: importance-sample the selection by light intensity and solid angle
						var lightPdf = 0.0;
						if ( misEnabled != 0u && lightsDenom > 0.0 ) {

							let ruv = ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } );
							let lightIndex = min( u32( ruv.x * lightsDenom ), u32( lightsDenom ) - 1u );
							var lightRec: ${ lightRecordStruct };
							if ( envActive && lightIndex == lightsCount ) {

								// the environment, sampled from its CDF, as a light of kind ENVIRONMENT
								let envSample = ${ sampleEnvDir }( ruv.yz );
								lightRec.direction = envSample.direction;
								lightRec.emission = envSample.color;
								lightRec.pdf = envSample.pdf;
								lightRec.dist = ${ LIGHT_FAR_DISTANCE };
								lightRec.lightType = ${ ENVIRONMENT_LIGHT_TYPE };

							} else {

								lightRec = ${ randomLightSampleFn }( lightIndex, hitResult.position, ruv.yz );

							}

							lightPdf = lightRec.pdf / lightsDenom;
							rayData[ index ].lightDirection = lightRec.direction;
							rayData[ index ].lightEmission = lightRec.emission;
							rayData[ index ].lightDist = lightRec.dist;
							rayData[ index ].lightType = lightRec.lightType;

						}

						rayData[ index ].lightPdf = lightPdf;

					} else {

						// the segment escaped the scene: gather the environment for opaque paths, or
						// the background for camera segments and fully transmissive paths
						if ( input.currentBounce > 0u && input.transmissiveRay == 0u ) {

							var misWeight = 1.0;
							if ( misEnabled != 0u && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( input.direction ) / lightsDenom;
								misWeight = ${ misHeuristicFn }( input.pdf, envPdf );

							}

							let environment = ${ sampleEnvColor }( input.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, input.currentBounce + 1u, clampDirect, clampIndirect );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( input.direction, rng );
							if ( input.currentBounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f( background, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( input.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;

								var misWeight = 1.0;
								if ( misEnabled != 0u && envActive ) {

									let envPdf = ${ getEnvDirPdf }( input.direction );
									misWeight = ${ misHeuristicFn }( input.pdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * misWeight, input.currentBounce + 1u, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * misWeight, input.currentBounce + 1u, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * misWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, input.currentBounce + 1u, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								}

							}

						}

						isTerminated = true;

					}

				}

				if ( isTerminated ) {

					// Blend the finished sample into the output and free the slot for a new camera
					// ray. The color rows are stored top down to match a rasterized render target.
					let colorIndex = vec2u( indexUV.x, textureDimensions( ${ params.outputTarget } ).y - 1u - indexUV.y );

					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_DISPATCHED_FLAG }u | sampleCount ) );
					textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

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
