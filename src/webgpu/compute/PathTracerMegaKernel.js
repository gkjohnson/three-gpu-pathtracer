import { DataTexture, Vector2, Vector4 } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './targets.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { blendAuxFn, isAuxSurfaceFn, AUX_LAYERS } from '../nodes/aux.wgsl.js';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_ALPHA_TEST, RNG_INDEX_MEDIUM_DISTANCE, RNG_INDEX_MEDIUM_DIRECTION, RNG_INDEX_MEDIUM_GUIDE } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn } from '../nodes/sampling.wgsl.js';
import { mediumSegmentStruct, mediumStackEnterFunc, mediumStackExitFn, stackMediumFunc, mediumChannelPdfFn, sampleMediumDistanceFn, findMediumOppositeFn, mediumSegmentPdfFn, sampleMediumDirectionFn, MEDIUM_THROUGHPUT_EPSILON, MEDIUM_STACK_EMPTY } from '../nodes/medium.wgsl.js';
import { proxy, proxyFn, contextProxy, contextProxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc } from '../nodes/utils.wgsl.js';
import { lightRecordStruct } from '../nodes/structs.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, LIGHT_EPSILON, isMISWeightLightFn } from '../nodes/lights.wgsl.js';
import { applyDispersionFunc, dispersionColorWeightFunc, DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH } from '../nodes/material.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../constants.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			material: { value: null },
			envInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( createOutputTarget() ).toReadOnly(),
			outputTarget: textureStore( createOutputTarget() ).toWriteOnly(),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),

			// tiles
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),

			// settings
			seed: uniform( 0 ),
			maxBounces: uniform( 5 ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			maxVolumeSteps: uniform( 256, 'uint' ),
			misEnabled: uniform( 1, 'uint' ),
			maxSamples: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			// the media the camera is inside of
			cameraMediumStack: uniform( new Vector4().setScalar( MEDIUM_STACK_EMPTY ), 'uvec4' ),

			backgroundInfo: { value: null },

			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),
			accumulateAux: uniform( 0, 'uint' ),

			// the per pixel first hit albedo and normal, as running means like the color
			auxTarget: textureStore( createAuxTarget() ).toReadWrite(),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			// compute variables
			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastFirstHitFn = contextProxyFn( 'bvhData.fns.raycastFirstHit' );
		const raycastShadowFn = contextProxyFn( 'bvhData.fns.raycastShadow' );
		const sampleTrianglePointFn = contextProxyFn( 'bvhData.fns.sampleTrianglePoint' );
		const getSurfaceRecordFn = contextProxyFn( 'bvhData.fns.getSurfaceRecord' );
		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		const transformsNode = contextProxy( 'bvhData.storage.transforms' );
		const materialsNode = contextProxy( 'bvhData.storage.materials' );
		const mediumStackEnterFn = mediumStackEnterFunc( transformsNode, materialsNode );
		const stackMediumFn = stackMediumFunc( transformsNode, materialsNode );

		// environment resources
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const getEnvWeight = proxy( 'envInfo.value.getWeight', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const randomLightSampleFn = proxyFn( 'lightsInfo.value.randomLightSample', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );
		const getLightWeightFn = proxyFn( 'lightsInfo.value.getLightWeight', params );
		const getLightsWeightFn = proxyFn( 'lightsInfo.value.getLightsWeight', params );
		const selectLightFn = proxyFn( 'lightsInfo.value.selectLight', params );
		const isLightVisibleToCameraFn = proxyFn( 'lightsInfo.value.isLightVisibleToCamera', params );

		const shader = wgslTagFn/* wgsl */`

			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				seed: u32,
				maxBounces: u32,
				maxTransparentBounces: u32,
				maxVolumeSteps: u32,
				misEnabled: u32,
				maxSamples: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,
				cameraMediumStack: vec4u,

				transmissiveBackground: u32,
				accumulateAux: u32,

			) -> void {

				let transforms = &${ contextProxy( 'bvhData.storage.transforms' ) };
				let materials = &${ contextProxy( 'bvhData.storage.materials' ) };

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

					// a declined pixel never takes a sample, so with a cap it counts as finished
					if ( maxSamples != 0u ) {

						textureStore( ${ params.sampleCountTarget }, indexUV, vec4( maxSamples ) );

					}

					return;

				}

				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var bsdfPdf = 0.0;
				var isFullyTransmissive = true;
				var minPdf = 1.0;
				var transparentBounce = 0u;

				// the media the path is inside of, starting from those around the camera
				var medium = ${ stackMediumFn }( cameraMediumStack, ${ MEDIUM_STACK_EMPTY }u, ray.origin, - ray.direction );
				var segment: ${ mediumSegmentStruct };
				var volumeSteps = 0u;

				// no light is sampled at a scatter event, so whatever the next segment reaches takes full weight
				var mediumScattered = false;
				// A negative value marks a sampled wavelength whose RGB reconstruction weight has not been applied yet.
				var dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );

				// one-sample NEE chooses between the analytic lights and the environment
				let envActive = ${ envTotalSumNode } > 0.0 && ${ envIntensityNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var envWeight = 0.0;
				if ( envActive ) {

					envWeight = ${ getEnvWeight }();

				}

				// added last, since a camera ray miss overwrites the pixel with the background
				var lightHits = vec3f( 0.0 );
				var cameraHitLight = false;

				// The first surface the path scatters off fills the denoiser's auxiliary images. Until one is found
				// the last mirror or transmission hit stands in, for paths that reach the environment. The albedo
				// is tinted by the throughput of the surfaces looked past to reach it
				var auxFound = false;
				var auxAlbedo = vec3f( 0.0 );
				var auxNormal = vec3f( 0.0 );

				for ( var bounce = 0u; bounce < maxBounces; bounce ++ ) {

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( ray, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// Inside a medium, sample a scatter event before the next surface
					let segmentInMedium = medium.inside;
					if ( medium.inside ) {

						let channelPdf = ${ mediumChannelPdfFn }( throughputColor, medium.albedo );
						let scatterDist = ${ sampleMediumDistanceFn }( medium, segment, channelPdf, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DISTANCE } ) );
						if ( medium.firstSegment ) {

							${ findMediumOppositeFn }( &medium, ray.origin, ray.direction, scatterDist, didHit && hitResult.objectIndex == medium.object, hitResult.dist );

						}

						let scattered = scatterDist < surfaceDist;
						let segmentDist = select( surfaceDist, scatterDist, scattered );
						let transmittance = exp( - medium.extinction * segmentDist );
						let distancePdf = dot( channelPdf, ${ mediumSegmentPdfFn }( medium, segment, segmentDist, scattered ) );
						if ( distancePdf <= 0.0 ) {

							break;

						}

						if ( ! scattered ) {

							// reaching the surface, weighted by the probability of no scatter event before it
							throughputColor *= transmittance / distancePdf;

						} else {

							throughputColor *= medium.albedo * medium.extinction * transmittance / distancePdf;
							ray.origin += ray.direction * scatterDist;
							ray.direction = ${ sampleMediumDirectionFn }( medium, ray.origin, ray.direction, ${ rand2 }( ${ RNG_INDEX_MEDIUM_GUIDE } ), ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ), &segment );
							ray.maxDist = 0.0;
							mediumScattered = true;
							isFullyTransmissive = false;

							// volume steps are capped separately from bounces
							volumeSteps ++;
							let maxThroughput = max( max( throughputColor.r, throughputColor.g ), throughputColor.b );
							if ( volumeSteps >= maxVolumeSteps || maxThroughput < ${ MEDIUM_THROUGHPUT_EPSILON } ) {

								break;

							}

							${ rngNextBounce }();
							bounce --;
							continue;

						}

					}

					// NEE's total weight at the vertex this ray left, for MIS. Camera rays have none, and
					// neither do scatter events in a medium
					let isMISWeighted = misEnabled != 0u && bounce > 0u && ! mediumScattered;
					var lightTotalWeight = 0.0;
					if ( isMISWeighted ) {

						lightTotalWeight = ${ getLightsWeightFn }( ray.origin ) + envWeight;

					}

					// forward hits on area lights. Camera rays only see visibleToCameraRays lights, at full weight
					for ( var li = 0u; li < lightsCount; li ++ ) {

						if ( bounce == 0u && ! ${ isLightVisibleToCameraFn }( li ) ) {

							continue;

						}

						var lightRec: ${ lightRecordStruct };
						if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								let selectionPdf = ${ getLightWeightFn }( li, ray.origin ) / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( bsdfPdf, lightRec.pdf * selectionPdf );

							}

							lightHits += ${ clampPathContributionFunc }( lightRec.emission * throughputColor * misWeight, bounce, clampDirect, clampIndirect );
							cameraHitLight = cameraHitLight || bounce == 0u;

						}

					}


					if ( didHit ) {

						// a medium that doesn't scatter only absorbs the light reaching the surface. One that
						// does has already applied its transmittance above
						if ( ! segmentInMedium ) {

							throughputColor *= exp( - medium.extinction * hitResult.dist );

						}

						let objectInfo = transforms[ hitResult.objectIndex ];
						var materialInfo = ( *materials )[ objectInfo.materialIndex ];

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

						var surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, hitResult.side, hitResult.normal, view, blurRoughness );

						// Stochastically pass through partially transparent surfaces by restarting
						// the ray at the hit point, advancing the rng but not the bounce count.
						if ( ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity ) {

							// stop once the transparent bounces run out
							if ( transparentBounce >= maxTransparentBounces ) {

								break;

							}

							ray.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, ray.direction, hitResult.normal );
							${ rngNextBounce }();
							transparentBounce ++;
							bounce --;
							continue;

						}

						let isDispersive = materialInfo.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
						if ( isDispersive ) {

							let wavelength = abs( dispersionWavelength );
							${ applyDispersionFunc }( &surface, materialInfo.dispersion, wavelength );
							if ( dispersionWavelength < 0.0 ) {

								dispersionWavelength = wavelength;
								throughputColor *= ${ dispersionColorWeightFunc }( wavelength );

							}

						}

						// emission, clamped at the depth of the segment that found it, as in Cycles
						let emission = ${ clampPathContributionFunc }( throughputColor * surface.emission, bounce, clampDirect, clampIndirect );
						resultColor += vec4f( emission, 0.0 );

						// next event estimation: choose one light or the environment by its estimated
						// contribution
						if ( misEnabled != 0u ) {

							let ruv = ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } );
							var selectionPdf = 0.0;
							let lightIndex = ${ selectLightFn }( vertexData.position.xyz, envWeight, ruv.x, &selectionPdf );
							if ( selectionPdf > 0.0 ) {

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
										shadowRay.maxDist = lightRec.dist * ( 1.0 - ${ LIGHT_EPSILON } );

										// opaque occlusion up to the light distance. A shadow-specific any hit
										// traversal could support tinted shadows from transmissive and partially
										// opaque objects
										var shadowHit: ${ raycastOutput };
										let occluded = ${ raycastShadowFn }( shadowRay, &shadowHit );
										if ( ! occluded ) {

											let lightPdf = lightRec.pdf * selectionPdf;

											// env + area lights are also bsdf-sampled, so MIS-weight them - punctual lights take full weight,
											// or when a bsdf ray could never reach the light or isn't traced past the bounce limit
											let isMISWeighted = ${ isMISWeightLightFn }( lightRec.lightType ) && ! shadowHit.forwardBlocked && bounce + 1u < maxBounces;
											let misWeight = select( 1.0, ${ misHeuristicFn }( lightPdf, evalRec.pdf ), isMISWeighted );
											let directLight = throughputColor * lightRec.emission * evalRec.color * misWeight / lightPdf;
											let contribution = ${ clampPathContributionFunc }( directLight, bounce + 1u, clampDirect, clampIndirect );
											resultColor += vec4f( contribution, 0.0 );

										}

									}

								}

							}

						}

						let scatterRec = ${ bsdfSampleFn }( view, surface );

						if ( ! auxFound ) {

							auxFound = ${ isAuxSurfaceFn }( surface, scatterRec );
							auxAlbedo = saturate( throughputColor * surface.color );
							auxNormal = surface.normal;

						}

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
						mediumScattered = false;

						// a direction from the bsdf isn't guided
						segment = ${ mediumSegmentStruct }();

						// As in "KHR_materials_scatter", a volume's surface bsdf is its boundary: light refracting in
						// through it enters the volume and out through it leaves, while light reflecting stays
						if ( scatterRec.isTransmissive && ! surface.thinWall ) {

							var stack: vec4u;
							if ( hitResult.side > 0.0 ) {

								stack = ${ mediumStackEnterFn }( medium.stack, hitResult.objectIndex );

							} else {

								stack = ${ mediumStackExitFn }( medium.stack, hitResult.objectIndex );

							}

							if ( any( stack != medium.stack ) ) {

								medium = ${ stackMediumFn }( stack, hitResult.objectIndex, vertexData.position.xyz, surface.normal );

							}

						}

						// exit if our throughput is 0.0
						if ( all( throughputColor == vec3f( 0.0 ) ) ) {

							break;

						}

						ray.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, hitResult.normal );
						ray.direction = scatterRec.direction;
						ray.maxDist = 0.0;

					} else {

						if ( bounce > 0u && ! isFullyTransmissive ) {

							var misWeight = 1.0;
							if ( isMISWeighted && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( ray.direction ) * envWeight / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

							}

							let environment = ${ sampleEnvColor }( ray.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, bounce, clampDirect, clampIndirect );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( ray.direction, rng );
							if ( bounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, bounce, clampDirect, clampIndirect );
								resultColor = vec4f( background, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( ray.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;
								var envMisWeight = 1.0;
								if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 ) {

									let envPdf = ${ getEnvDirPdf }( ray.direction );
									envMisWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * envMisWeight, bounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * envMisWeight, bounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * envMisWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, bounce, clampDirect, clampIndirect );
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

				// visible lights are opaque against a transparent background
				resultColor += vec4f( lightHits, 0.0 );
				if ( cameraHitLight ) {

					resultColor.a = 1.0;

				}

				let nextSampleCount = sampleCount + 1;
				// store the color rows top down to match a rasterized render target
				let colorIndex = vec2u( indexUV.x, targetDimensions.y - 1u - indexUV.y );

				let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
				let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( nextSampleCount ) );
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( nextSampleCount ) );
				textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

				// the auxiliary images are blended the same way, in the same row order
				if ( accumulateAux != 0u ) {

					var auxPacked: vec3u;
					for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

						auxPacked[ layer ] = textureLoad( ${ params.auxTarget }, colorIndex, layer ).r;

					}

					auxPacked = ${ blendAuxFn }( auxPacked, auxAlbedo, auxNormal, 1.0 / f32( nextSampleCount ) );
					for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

						textureStore( ${ params.auxTarget }, colorIndex, layer, vec4u( auxPacked[ layer ] ) );

					}

				}

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );

	}

}
