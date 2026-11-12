import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from '../targets.js';
import { blendAuxFn, AUX_LAYERS } from '../../nodes/auxiliary.wgsl.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { clampPathContributionFunc, isTerminatingScatterFunc } from '../../nodes/utils.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../../constants.js';
import {
	rngInit, rand2, rand3,
	RNG_INDEX_BACKGROUND_SAMPLE,
	RNG_INDEX_DIRECT_LIGHT_SAMPLE,
} from '../../nodes/random.wgsl.js';
import { LIGHT_FAR_DISTANCE } from '../../nodes/lights.wgsl.js';
import { scatterRecordStruct } from '../../nodes/structs.wgsl.js';
import { rayDataStruct, intersectionResultStruct, shadowTraceResultStruct } from './structs.js';
import { getMediumSegmentWeightFn } from '../../nodes/medium.wgsl.js';
import { SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';

// Path logic over the persistent slot pool: resolves the previous frame's shadow and bounce trace
// results, accumulates emission and NEE / forward MIS contributions, terminates finished paths into
// the output, and samples the next NEE light for MaterialKernel. Touches no BVH data.
export class LogicKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			// TODO: provide these through the context, as bvhData, random and shadingModel are
			envInfo: { value: null },
			backgroundInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( createOutputTarget() ).toReadOnly(),
			outputTarget: textureStore( createOutputTarget() ).toWriteOnly(),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),

			// the per pixel first hit albedo and normal, as running means like the color
			auxTarget: textureStore( createAuxTarget() ).toReadWrite(),

			// settings
			globalSeed: uniform( 0, 'uint' ),
			misEnabled: uniform( 1, 'uint' ),
			rayCount: uniform( 0, 'uint' ),
			maxBounces: uniform( 5, 'uint' ),
			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),
			accumulateAux: uniform( 0, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayIntersectionsStorage: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),
			shadowRayIntersectionsStorage: storage( new StorageBufferAttribute( 1, 1 ), shadowTraceResultStruct ),

			globalId: globalId,
		};

		// environment + background resources pulled off their providers (embedded functions)
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider (LightsInfoNode)
		const getDirectLightFn = proxyFn( 'lightsInfo.value.getDirectLight', params );
		const getLightHitsFn = proxyFn( 'lightsInfo.value.getLightHits', params );
		const getEnvironmentPdfFn = proxyFn( 'lightsInfo.value.getEnvironmentPdf', params );
		const sampleLightFn = proxyFn( 'lightsInfo.value.sampleLight', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				globalSeed: u32,
				misEnabled: u32,
				rayCount: u32,
				maxBounces: u32,
				transmissiveBackground: u32,
				accumulateAux: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let rayIntersectionsStorage = &${ params.rayIntersectionsStorage };
				let shadowRayIntersectionsStorage = &${ params.shadowRayIntersectionsStorage };

				// bound by "rayCount" rather than the pool length. See MaterialKernel
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// skip slots that have never spawned a ray
				// whole structs are read from the buffer, not the pointer alias, which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.rayIntersectionIndex < 0 ) {

					return;

				}

				let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
				${ rngInit }( globalSeed, indexUV, input.sampleIndex, input.hit.bounce + input.alphaDepth + input.subsurfaceBounces );

				var resultColor = input.resultColor;
				var throughputColor = input.throughputColor;

				// added last, since a camera ray miss overwrites the pixel with the background
				var lightHitColor = vec3f( 0.0 );
				var cameraHitLight = input.cameraHitLight != 0u;

				// resolve the previous surface's NEE shadow ray (pre-scatter throughput). The index
				// is negative when no shadow ray was enqueued last frame
				if ( input.shadowRayIntersectionIndex >= 0 && input.lightPdf > 0.0 ) {

					let shadowHit = ${ params.shadowRayIntersectionsStorage }[ u32( input.shadowRayIntersectionIndex ) ];
					let occluded = shadowHit.objectIndex >= 0;
					if ( ! occluded ) {

						let directLight = ${ getDirectLightFn }(
							input.lightPdf, input.lightEmission, input.lightType, input.lightEvalColor, input.lightEvalPdf,
							shadowHit.transmittance, shadowHit.skippedOcclusion, throughputColor, input.hit.bounce, maxBounces,
						);
						resultColor += vec4f( directLight, 0.0 );

					}

				}

				// emission gathered at the previous surface (pre-scatter throughput). Found light clamps
				// at the depth of the segment that found it, as in Cycles, so one less than the current
				let emission = ${ clampPathContributionFunc }( throughputColor * input.emission, max( input.hit.bounce, 1u ) - 1u );
				resultColor += vec4f( emission, 0.0 );

				// reconstruct the scatter record staged by MaterialKernel
				var scatterRec: ${ scatterRecordStruct };
				scatterRec.color = input.scatterColor;
				scatterRec.pdf = input.scatterPdf;

				// the bounce limit, russian roulette, and terminating scatter checks all ran in
				// MaterialKernel, which stages a zeroed pdf and skips the bounce trace when they fire
				var isTerminated = all( throughputColor == vec3f( 0.0 ) ) || input.hit.bounce >= maxBounces || ${ isTerminatingScatterFunc }( scatterRec );

				// apply the scatter across the traced segment, including the weight of a medium walk
				if ( ! isTerminated ) {

					throughputColor *= scatterRec.color / scatterRec.pdf;

				}

				let isWalking = ! isTerminated && input.walkPending != 0u;
				if ( isWalking ) {

					// the walk hasn't reached a surface yet, so there's no hit to stage. Clear what was
					// resolved and let SubsurfaceKernel accumulate the walk's weight
					rayDataStorage[ index ].emission = vec3f( 0.0 );
					rayDataStorage[ index ].lightPdf = 0.0;
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
					rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
					rayDataStorage[ index ].scatterPdf = 1.0;

				} else if ( ! isTerminated ) {

					let hitResult = ${ params.rayIntersectionsStorage }[ u32( input.rayIntersectionIndex ) ];
					let didHitSurface = hitResult.objectIndex >= 0;
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHitSurface );

					// the segment's medium weight. In fog it scatters at its sampled distance unless a surface is nearer, a
					// vertex staged like a surface hit
					throughputColor *= ${ getMediumSegmentWeightFn }( input.medium, throughputColor, input.scatterDist, surfaceDist );
					let isFogScatter = input.scatterDist > 0.0 && input.scatterDist < surfaceDist;
					let segmentDist = select( surfaceDist, input.scatterDist, isFogScatter );

					let didHit = didHitSurface || isFogScatter;

					// MIS weights against the light sampling at the vertex this segment left. Camera segments have none,
					// and neither do scatter events in a subsurface walk
					let isMISWeighted = misEnabled != 0u && input.hit.bounce > 0u && input.mediumScattered == 0u;

					// forward hits on area lights along the traced segment, which starts "rayStart" along the ray
					let segmentLightHits = ${ getLightHitsFn }( input.origin, input.direction, input.rayStart, input.rayStart + segmentDist, throughputColor, input.scatterPdf, isMISWeighted, input.hit.bounce );
					lightHitColor += segmentLightHits.rgb;
					cameraHitLight = cameraHitLight || ( input.hit.bounce == 0u && segmentLightHits.a > 0.0 );

					if ( didHit ) {

						// stage the hit for MaterialKernel
						rayDataStorage[ index ].hit.barycoord = hitResult.barycoord;
						rayDataStorage[ index ].hit.normal = hitResult.normal;
						rayDataStorage[ index ].hit.side = hitResult.side;
						rayDataStorage[ index ].hit.indices = hitResult.indices;
						rayDataStorage[ index ].hit.dist = hitResult.dist;
						rayDataStorage[ index ].fogScatter = select( 0u, 1u, isFogScatter );

						// a fog scatter has no object, and is staged at "origin". Any non-negative index keeps the slot from
						// being respawned, and MaterialKernel handles the scatter before reading the object
						var position = hitResult.position;
						rayDataStorage[ index ].hit.objectIndex = max( hitResult.objectIndex, 0 );
						if ( isFogScatter ) {

							position = input.origin + input.direction * ( input.rayStart + input.scatterDist );
							rayDataStorage[ index ].origin = position;

						}

						// next event estimation: choose one light or the environment by its estimated
						// contribution. MaterialKernel evaluates the bsdf, or the phase function at a scatter
						// event in fog, and enqueues the shadow ray
						var lightPdf = 0.0;
						if ( misEnabled != 0u ) {

							let lightRec = ${ sampleLightFn }( position, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );
							if ( lightRec.pdf > 0.0 ) {

								lightPdf = lightRec.pdf;
								rayDataStorage[ index ].lightDirection = lightRec.direction;
								rayDataStorage[ index ].lightEmission = lightRec.emission;
								rayDataStorage[ index ].lightDist = lightRec.dist;
								rayDataStorage[ index ].lightType = lightRec.lightType;

							}

						}

						rayDataStorage[ index ].lightPdf = lightPdf;

					} else {

						// the segment escaped the scene: gather the environment for opaque paths, or
						// the background for camera segments and fully transmissive paths
						if ( input.hit.bounce > 0u && input.isFullyTransmissive == 0u ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								// weighted against the light sampling choosing the environment
								let envPdf = ${ getEnvironmentPdfFn }( input.origin, input.direction );
								misWeight = select( 1.0, ${ misHeuristicFn }( input.scatterPdf, envPdf ), envPdf > 0.0 );

							}

							let environment = ${ sampleEnvColor }( input.direction ).rgb * throughputColor * misWeight;
							let environmentLight = ${ clampPathContributionFunc }( environment, input.hit.bounce );
							resultColor += vec4f( environmentLight, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( input.direction, rng );
							if ( input.hit.bounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, input.hit.bounce );
								resultColor = vec4f( background, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( input.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;

								var misWeight = 1.0;
								if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 && ${ envIntensityNode } > 0.0 ) {

									let envPdf = ${ getEnvDirPdf }( input.direction );
									misWeight = ${ misHeuristicFn }( input.scatterPdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * misWeight, input.hit.bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * misWeight, input.hit.bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * misWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, input.hit.bounce );
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

				// visible lights are opaque against a transparent background
				resultColor += vec4f( lightHitColor, 0.0 );
				if ( cameraHitLight ) {

					resultColor.a = 1.0;

				}

				// the color rows are stored top down to match a rasterized render target
				let colorIndex = vec2u( indexUV.x, textureDimensions( ${ params.outputTarget } ).y - 1u - indexUV.y );
				let storedSamples = textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u;

				if ( isTerminated ) {

					// blend the finished sample into the output and free the slot for a new camera ray
					let sampleCount = storedSamples + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_DISPATCHED_FLAG }u | sampleCount ) );
					textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

					// the auxiliary images are blended the same way, in the same row order
					if ( accumulateAux != 0u ) {

						var auxPacked: vec3u;
						for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

							auxPacked[ layer ] = textureLoad( ${ params.auxTarget }, colorIndex, layer ).r;

						}

						let albedo = unpack4x8unorm( input.auxAlbedo ).rgb;
						let normal = unpack4x8snorm( input.auxNormal ).xyz;
						auxPacked = ${ blendAuxFn }( auxPacked, albedo, normal, 1.0 / f32( sampleCount ) );
						for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

							textureStore( ${ params.auxTarget }, colorIndex, layer, vec4u( auxPacked[ layer ] ) );

						}

					}

					rayDataStorage[ index ].hit.objectIndex = - 1;

				} else {

					// show the path so far, which the first sample overwrites
					if ( storedSamples == 0u ) {

						textureStore( ${ params.outputTarget }, colorIndex, resultColor );

					}

					rayDataStorage[ index ].resultColor = resultColor;
					rayDataStorage[ index ].throughputColor = throughputColor;
					rayDataStorage[ index ].cameraHitLight = select( 0u, 1u, cameraHitLight );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
