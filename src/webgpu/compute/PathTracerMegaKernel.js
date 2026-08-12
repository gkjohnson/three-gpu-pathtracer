import { DataTexture, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SELECTION, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_DIRECT_ENV_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn, luminanceFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { isTerminatingScatterFunc } from '../nodes/utils.wgsl.js';
import { lightRecordStruct } from '../nodes/structs.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, isMISWeightLightFn } from '../nodes/lights.wgsl.js';
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
			filterGlossy: uniform( 1 ),

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
				filterGlossy: f32,

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

				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				${ rngInit }( indexUV.xy, seed, 0 );

				// scene ray
				let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
				var ray = ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ) );
				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var bsdfPdf = 0.0;
				var isFullyTransmissive = true;
				var minPdf = 1.0;


				// one-sample next event estimation selects between the analytic lights and the
				// environment. lightsDenom normalizes that selection: the light count, plus one
				// for the environment when it is active.
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

					// forward MIS: a bsdf-sampled ray that lands on a ( non-occluded ) area light.
					// Only area lights can be hit this way; the camera ray is skipped.
					if ( misEnabled != 0u && bounce > 0u ) {

						for ( var li = 0u; li < lightsCount; li ++ ) {

							var lightRec: ${ lightRecordStruct };
							if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

								let lightPdf = lightRec.pdf / lightsDenom;
								let misWeight = ${ misHeuristicFn }( bsdfPdf, lightPdf );
								resultColor += vec4f( lightRec.emission * throughputColor * misWeight, 0.0 );

							}

						}

					}

					if ( didHit ) {

						let objectInfo = transforms[ hitResult.objectIndex ];
						var materialInfo = materials[ objectInfo.materialIndex ];

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
						resultColor += vec4f( throughputColor * surface.emission, 0.0 );

						// next event estimation
						// draw one light among the analytic lights + the environment ( env is the last "light" when
							// active ), each with probability 1 / lightsDenom, and MIS-weight it against the bsdf pdf.
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

									lightRec = ${ randomLightSampleFn }( vertexData.position.xyz, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

								}

								// reject samples that fall below the geometric surface
								var lightPdf = lightRec.pdf;
								if ( dot( surface.faceNormal, lightRec.direction ) < 0.0 ) {

									lightPdf = 0.0;

								}

								if ( lightPdf > 0.0 ) {

									let evalRec = ${ bsdfEvalPdfFn }( view, lightRec.direction, surface );
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
											resultColor += vec4f( throughputColor * lightRec.emission * evalRec.color * misWeight / lightPdf, 0.0 );

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

						// russian roulette early out
						if ( bounce >= 3u ) {

							let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
							let rrProb = sqrt( saturate( ${ luminanceFn }( rrThroughput ) / max( ${ luminanceFn }( throughputColor ), 1e-4 ) ) );
							if ( ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

								break;

							}

							// perform sample clamping here to avoid bright pixels
							throughputColor *= min( 1.0 / rrProb, 20.0 );

						}

						throughputColor *= scatterRec.color;
						throughputColor /= scatterRec.pdf;
						bsdfPdf = scatterRec.pdf;

						// exit if our throughput is 0.0
						if ( all( throughputColor == vec3f( 0.0 ) ) ) {

							break;

						}

						// TODO: Investigate offsetting this position to not self-intersect multiple times
						// Adding + scatterRec.direction * 1e-1 seems to fix almost all the fireflies
						// However that seems like a very large distance to offset
						ray.origin = vertexData.position.xyz;
						ray.direction = scatterRec.direction;

					} else {

						if ( bounce > 0u && ! isFullyTransmissive ) {

							var misWeight = 1.0;
							if ( misEnabled != 0u && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( ray.direction ) / lightsDenom;
								misWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

							}

							resultColor += ${ sampleEnvColor }( ray.direction ) * vec4f( throughputColor * misWeight, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( ray.direction, rng );
							if ( bounce == 0u ) {

								// sample the background directly if this is the primary ray
								resultColor = vec4f( bg.a * bg.rgb, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( ray.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									resultColor = vec4f(
										resultColor.rgb + env.rgb * throughputColor,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									resultColor = vec4f(
										resultColor.rgb + bg.a * bg.rgb * throughputColor,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a );
									resultColor = vec4f(
										resultColor.rgb + light * throughputColor,
										1.0 - transparency,
									);

								}

							}

						}

						break;

					}

					${ rngNextBounce }();

				}

				let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r + 1;
				let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
				let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
				textureStore( ${ params.outputTarget }, indexUV, blendedColor );

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );

	}

}
