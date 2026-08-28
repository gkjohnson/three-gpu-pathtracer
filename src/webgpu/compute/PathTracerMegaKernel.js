import { DataTexture, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc } from '../nodes/utils.wgsl.js';
import { lightRecordStruct } from '../nodes/structs.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, LIGHT_EPSILON, isMISWeightLightFn } from '../nodes/lights.wgsl.js';
import { transmissionAttenuationFunc } from '../nodes/material.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../constants.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },
			envInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// tiles
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),

			// settings
			seed: uniform( 0 ),
			bounces: uniform( 5 ),
			misEnabled: uniform( 1, 'uint' ),
			maxSamples: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			backgroundInfo: { value: null },

			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			// compute variables
			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const getCameraRayFn = proxyFn( 'bvhData.value.fns.getCameraRay', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		// environment resources
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const randomLightSampleFn = proxyFn( 'lightsInfo.value.randomLightSample', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );

		const shader = wgslTagFn/* wgsl */`

			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				seed: u32,
				bounces: u32,
				misEnabled: u32,
				maxSamples: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,

				transmissiveBackground: u32,

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

				// make sure we don't bleed over the edge of our tile
				if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {

					return;

				}

				// to screen coordinates
				let indexUV = offset + globalId.xy;
				let targetDimensions = textureDimensions( ${ params.outputTarget } );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				// skip the pixel once it has hit the sample limit
				let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
				if ( maxSamples != 0u && sampleCount >= maxSamples ) {

					return;

				}

				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				${ rngInit }( indexUV.xy, seed, 0 );

				// scene ray
				let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
				var ray: ${ rayStruct };
				if ( ! ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ), &ray ) ) {

					return;

				}

				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var bsdfPdf = 0.0;
				var isFullyTransmissive = true;
				var minPdf = 1.0;

				// one-sample NEE selects between the analytic lights and the environment -
				// lightsDenom is the number of options
				let envActive = ${ envTotalSumNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var lightsDenom = f32( lightsCount );
				if ( envActive ) {

					lightsDenom += 1.0;

				}

				for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( ray, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// forward MIS: a bsdf-sampled ray that lands on a area light.
					if ( misEnabled != 0u && bounce > 0u ) {

						for ( var li = 0u; li < lightsCount; li ++ ) {

							var lightRec: ${ lightRecordStruct };
							if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

								let lightPdf = lightRec.pdf / lightsDenom;
								let misWeight = ${ misHeuristicFn }( bsdfPdf, lightPdf );
								let lightHit = ${ clampPathContributionFunc }( lightRec.emission * throughputColor * misWeight, bounce + 1u, clampDirect, clampIndirect );
								resultColor += vec4f( lightHit, 0.0 );

							}

						}

					}

					if ( didHit ) {

						let objectInfo = transforms[ hitResult.objectIndex ];
						var materialInfo = materials[ objectInfo.materialIndex ];

						// a matte surface hit by the camera ray renders as a fully transparent
						if ( materialInfo.matte != 0 && bounce == 0u ) {

							resultColor = vec4f( 0.0 );
							break;

						}

						// apply per-object colors
						materialInfo.color *= objectInfo.color.rgb;
						materialInfo.opacity *= objectInfo.color.a;

						let view = - ray.direction;
						var vertexData = ${ sampleTrianglePointFn }( hitResult.barycoord, hitResult.indices.xyz );
						vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
						vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
						vertexData.position = objectInfo.matrixWorld * vertexData.position;

						// blur glossy surfaces after low-probability bounces to suppress fireflies,
						// from the Cycles "filter glossy" approach in integrator/surface_shader.h
						// The smallest pdf seen along the path for the glossy filter is tracked below
						let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * minPdf, 0.0, 1.0 ) ) * 0.5;

						let surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, hitResult.side, hitResult.normal, view, blurRoughness );

						// attenuate the light transmitted through the volume when exiting a backface
						if ( hitResult.side < 0.0 && materialInfo.transmission > 0.0 ) {

							throughputColor *= ${ transmissionAttenuationFunc }( hitResult.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

						}

						// emission
						let emission = ${ clampPathContributionFunc }( throughputColor * surface.emission, bounce + 1u, clampDirect, clampIndirect );
						resultColor += vec4f( emission, 0.0 );

						// next event estimation: draw one light or the environment, each with
						// probability 1 / lightsDenom
						if ( misEnabled != 0u && lightsDenom > 0.0 ) {

							// pick one light or the environment with a single sample
							// TODO: importance-sample the selection by light intensity and solid angle
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

								lightRec = ${ randomLightSampleFn }( lightIndex, vertexData.position.xyz, ruv.yz );

							}

								if ( lightRec.pdf > 0.0 ) {

									let evalRec = ${ bsdfEvalPdfFn }( view, lightRec.direction, surface );
									if ( evalRec.pdf > 0.0 ) {

										var shadowRay: ${ rayStruct };
										shadowRay.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, lightRec.direction, hitResult.normal );
										shadowRay.direction = lightRec.direction;

										// opaque occlusion up to the light distance. A shadow-specific any hit traversal could support
										// tinted shadows from transmissive and partially opaque objects
										var shadowHit: ${ raycastOutput };
										let occluded = ${ raycastFirstHitFn }( shadowRay, &shadowHit ) && shadowHit.dist < lightRec.dist - ${ LIGHT_EPSILON };
										if ( ! occluded ) {

											var lightPdf = lightRec.pdf;
											lightPdf /= lightsDenom;

											// env + area lights are also bsdf-sampled, so MIS-weight them - punctual lights take full weight
											let misWeight = select( 1.0, ${ misHeuristicFn }( lightPdf, evalRec.pdf ), ${ isMISWeightLightFn }( lightRec.lightType ) );
											let directLight = throughputColor * lightRec.emission * evalRec.color * misWeight / lightPdf;
											let contribution = ${ clampPathContributionFunc }( directLight, bounce + 1u, clampDirect, clampIndirect );
											resultColor += vec4f( contribution, 0.0 );

										}

									}

								}

						}

						let scatterRec = ${ bsdfSampleFn }( view, surface );
						if ( ${ isTerminatingScatterFunc }( scatterRec ) ) {

							break;

						}

						isFullyTransmissive = isFullyTransmissive && scatterRec.isTransmissive;

						// track the smallest pdf seen along the path for the glossy filter
						minPdf = min( minPdf, scatterRec.pdf );

						// russian roulette early out:
						// Matches Cycles path_state_continuation_probability in integrator/path_state.h
						if ( bounce >= 3u ) {

							let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
							let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
							if ( rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

								break;

							}

							throughputColor /= rrProb;

						}

						throughputColor *= scatterRec.color;
						throughputColor /= scatterRec.pdf;
						bsdfPdf = scatterRec.pdf;

						// exit if our throughput is 0.0
						if ( all( throughputColor == vec3f( 0.0 ) ) ) {

							break;

						}

						ray.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, hitResult.normal );
						ray.direction = scatterRec.direction;

					} else {

						if ( bounce > 0u && ! isFullyTransmissive ) {

							var misWeight = 1.0;
							if ( misEnabled != 0u && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( ray.direction ) / lightsDenom;
								misWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

							}

							let environment = ${ sampleEnvColor }( ray.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, bounce + 1u, clampDirect, clampIndirect );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( ray.direction, rng );
							if ( bounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, bounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f( background, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( ray.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;
								var envMisWeight = 1.0;
								if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 ) {

									let envPdf = ${ getEnvDirPdf }( ray.direction );
									envMisWeight = ${ misHeuristicFn }( misPdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * envMisWeight, bounce + 1u, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * envMisWeight, bounce + 1u, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * envMisWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, bounce + 1u, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								}

							}

						}

						break;

					}

					${ rngNextBounce }();

				}

				let nextSampleCount = sampleCount + 1;
				// store the color rows top down to match a rasterized render target
				let colorIndex = vec2u( indexUV.x, targetDimensions.y - 1u - indexUV.y );

				let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
				let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( nextSampleCount ) );
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( nextSampleCount ) );
				textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );

	}

}
