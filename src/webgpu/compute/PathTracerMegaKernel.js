import { DataTexture, Vector2 } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './targets.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { blendAuxFn, isAuxSurfaceFn, AUX_LAYERS } from '../nodes/auxiliary.wgsl.js';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_ALPHA_TEST, RNG_INDEX_MEDIUM_DISTANCE, RNG_INDEX_MEDIUM_DIRECTION } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn, sampleHenyeyGreensteinFn, henyeyGreensteinPdfFn } from '../nodes/sampling.wgsl.js';
import {
	mediumStackStruct, addToMediumStackFn, removeFromMediumStackFn, getCombinedMediumFn, getSubsurfaceMediumFn, isSubsurfaceMaterialFn,
	getMediumStackAtPointFn, getShadowMediumStackFn, getShadowMediumDepthFn, getShadowTransmittanceFn, sampleFogDistanceFn,
	getMediumSegmentWeightFn, walkMediumStepFn, MEDIUM_WALK_SURFACE, MEDIUM_WALK_TERMINATED,
} from '../nodes/medium.wgsl.js';
import { proxy, proxyFn, contextProxy, contextProxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc } from '../nodes/utils.wgsl.js';
import { lightRecordStruct, hitRecordStruct, scatterRecordStruct } from '../nodes/structs.wgsl.js';
import { LIGHT_FAR_DISTANCE, LIGHT_EPSILON } from '../nodes/lights.wgsl.js';
import { applyDispersionFunc, dispersionColorWeightFunc, DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH } from '../nodes/material.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../constants.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			// TODO: provide these through the context, as bvhData, random and shadingModel are
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
			sampleIndex: uniform( 0 ),
			globalSeed: uniform( 0, 'uint' ),
			maxBounces: uniform( 5, 'uint' ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			maxSubsurfaceBounces: uniform( 256, 'uint' ),
			maxFogBounces: uniform( 0, 'uint' ),
			misEnabled: uniform( 1, 'uint' ),
			maxSamples: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),

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
		const getSurfaceRecordFn = contextProxyFn( 'shadingModel.fns.getSurfaceRecord' );
		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );
		const bsdfSampleFn = contextProxyFn( 'shadingModel.fns.bsdfSample' );
		const bsdfEvalPdfFn = contextProxyFn( 'shadingModel.fns.bsdfEvalPdf' );
		const materialsStorage = contextProxy( 'shadingModel.storage.materials' );
		const transformsStorage = contextProxy( 'bvhData.storage.transforms' );

		// environment resources
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const getDirectLightFn = proxyFn( 'lightsInfo.value.getDirectLight', params );
		const getLightHitsFn = proxyFn( 'lightsInfo.value.getLightHits', params );
		const getEnvironmentPdfFn = proxyFn( 'lightsInfo.value.getEnvironmentPdf', params );
		const sampleLightFn = proxyFn( 'lightsInfo.value.sampleLight', params );

		// Returns the light a light sample adds at a path vertex, given the vertex evaluated toward the light: the
		// shadow ray the wavefront queues, traces and resolves, starting at the origin in the given media
		const getLightContributionFn = wgslTagFn/* wgsl */`
			fn getLightContribution(
				lightRec: ${ lightRecordStruct }, evalColor: vec3f, evalPdf: f32, origin: vec3f, stack: ${ mediumStackStruct },
				throughput: vec3f, bounce: u32, maxBounces: u32,
			) -> vec3f {

				if ( evalPdf <= 0.0 ) {

					return vec3f( 0.0 );

				}

				// the shadow ray toward the light, up to the light distance
				var shadowRay: ${ rayStruct };
				shadowRay.origin = origin;
				shadowRay.direction = lightRec.direction;
				shadowRay.maxDist = lightRec.dist * ( 1.0 - ${ LIGHT_EPSILON } );
				let mediumDepth = ${ getShadowMediumDepthFn }( stack, shadowRay.maxDist );

				// opaque occlusion, and the light let through by the partially transparent surfaces and the volumes passed
				var shadowHit: ${ raycastOutput };
				let occluded = ${ raycastShadowFn }( shadowRay, &shadowHit );
				let transmittance = ${ getShadowTransmittanceFn }( mediumDepth + shadowHit.fogDepth, shadowHit.occlusion );
				if ( occluded ) {

					return vec3f( 0.0 );

				}

				return ${ getDirectLightFn }(
					lightRec.pdf, lightRec.emission, lightRec.lightType, evalColor, evalPdf,
					transmittance, shadowHit.skippedOcclusion, throughput, bounce + 1u, maxBounces,
				);

			}
		`;

		const shader = wgslTagFn/* wgsl */`

			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				sampleIndex: u32,
				globalSeed: u32,
				maxBounces: u32,
				maxTransparentBounces: u32,
				maxSubsurfaceBounces: u32,
				maxFogBounces: u32,
				misEnabled: u32,
				maxSamples: u32,
				filterGlossy: f32,

				transmissiveBackground: u32,
				accumulateAux: u32,

			) -> void {

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
				${ rngInit }( globalSeed, indexUV.xy, sampleIndex, 0 );

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

				// CameraRayKernel
				// path state
				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var scatterPdf = 1.0;
				var minPdf = 1.0;
				var isFullyTransmissive = true;

				// alpha pass throughs move the traversal start, "rayStart" along the ray, and keep the origin for MIS
				var alphaDepth = 0u;
				var rayStart = 0.0;
				var maxDist = ray.maxDist;
				var traceOrigin = ray.origin;

				// negative until the first dispersive hit applies its weight
				var dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );

				// scatter events in subsurface walks and fog, counted apart from bounces
				var subsurfaceBounces = 0u;
				var fogBounces = 0u;

				// set after a subsurface scatter, where no light is sampled
				var mediumScattered = false;

				// CameraMediumKernel
				// the medium the camera ray starts in
				var medium = ${ getCombinedMediumFn }( ${ getMediumStackAtPointFn }( ray.origin ) );

				// added last, a camera miss overwrites the pixel with the background
				var lightHits = vec3f( 0.0 );
				var cameraHitLight = false;

				// the denoiser's albedo and normal, from the first scatter, or the last mirror or transmission hit
				var auxFound = false;
				var auxAlbedo = vec3f( 0.0 );
				var auxNormal = vec3f( 0.0 );

				for ( var bounce = 0u; bounce < maxBounces; bounce ++ ) {

					// TraceRayKernel, or SubsurfaceKernel in a subsurface medium
					// trace the segment, in fog up to a sampled scatter distance, or walk it scatter by scatter to a surface
					var traceRay = Ray( traceOrigin, ray.direction, 0.0 );
					var hitResult: ${ raycastOutput };
					var didHitSurface = false;
					var scatterDist = 0.0;
					if ( medium.subsurface != 0u ) {

						var isWalkTerminated = false;
						loop {

							var stepWeight = vec3f( 0.0 );
							let walkStep = ${ walkMediumStepFn }(
								medium, throughputColor, maxSubsurfaceBounces,
								&traceRay, &hitResult, &stepWeight, &subsurfaceBounces,
							);
							throughputColor *= stepWeight;

							if ( walkStep == ${ MEDIUM_WALK_SURFACE }u ) {

								didHitSurface = hitResult.didHit;
								break;

							} else if ( walkStep == ${ MEDIUM_WALK_TERMINATED }u ) {

								isWalkTerminated = true;
								break;

							}

							mediumScattered = true;
							isFullyTransmissive = false;
							${ rngNextBounce }();

						}

						if ( isWalkTerminated ) {

							break;

						}

						// the walk ends with a segment from its last scatter
						ray.origin = traceRay.origin;
						ray.direction = traceRay.direction;
						rayStart = 0.0;
						traceOrigin = ray.origin;

					} else {

						scatterDist = ${ sampleFogDistanceFn }( medium, throughputColor, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DISTANCE } ) );
						traceRay.maxDist = select( maxDist, select( scatterDist, min( maxDist, scatterDist ), maxDist > 0.0 ), scatterDist > 0.0 );
						didHitSurface = ${ raycastFirstHitFn }( traceRay, &hitResult );

					}

					// LogicKernel
					var surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHitSurface );

					// the segment's medium weight. In fog it scatters at its sampled distance unless a surface is nearer
					throughputColor *= ${ getMediumSegmentWeightFn }( medium, throughputColor, scatterDist, surfaceDist );
					let isFogScatter = scatterDist > 0.0 && scatterDist < surfaceDist;
					surfaceDist = select( surfaceDist, scatterDist, isFogScatter );

					let didHit = didHitSurface || isFogScatter;

					// MIS against the light sampling at the previous vertex. None for camera segments or subsurface scatters
					let isMISWeighted = misEnabled != 0u && bounce > 0u && ! mediumScattered;

					// area lights crossed along the segment
					let segmentLight = ${ getLightHitsFn }( ray.origin, ray.direction, rayStart, rayStart + surfaceDist, throughputColor, scatterPdf, isMISWeighted, bounce );
					lightHits += segmentLight.rgb;
					cameraHitLight = cameraHitLight || ( bounce == 0u && segmentLight.a > 0.0 );

					// next event estimation. The vertex below evaluates the bsdf or phase function toward the light. A fog
					// scatter has no surface, its position is measured along the ray from the origin
					var position = traceOrigin + ray.direction * surfaceDist;
					if ( isFogScatter ) {

						position = ray.origin + ray.direction * ( rayStart + scatterDist );

					}

					var lightRec: ${ lightRecordStruct };
					if ( didHit ) {

						if ( misEnabled != 0u ) {

							lightRec = ${ sampleLightFn }( position, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

						}

					} else {

						// escaped: the environment, or the background for camera segments and fully transmissive paths
						if ( bounce > 0u && ! isFullyTransmissive ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								// weighted against the light sampling choosing the environment
								let envPdf = ${ getEnvironmentPdfFn }( ray.origin, ray.direction );
								misWeight = select( 1.0, ${ misHeuristicFn }( scatterPdf, envPdf ), envPdf > 0.0 );

							}

							let environment = ${ sampleEnvColor }( ray.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, bounce );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// the background, blended by the transmissive background mode
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( ray.direction, rng );
							if ( bounce == 0u ) {

								// camera ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, bounce );
								resultColor = vec4f( background, bg.a );

							} else {

								// seen through transmissive surfaces
								let env = ${ sampleEnvColor }( ray.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;

								var misWeight = 1.0;
								if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 && ${ envIntensityNode } > 0.0 ) {

									let envPdf = ${ getEnvDirPdf }( ray.direction );
									misWeight = ${ misHeuristicFn }( scatterPdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * misWeight, bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * misWeight, bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * misWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								}

							}

						}

						break;

					}

					// MaterialKernel
					// the vertex: its light evaluation, next direction, and where the bounce and shadow rays start
					var scatterRec: ${ scatterRecordStruct };
					var lightEvalColor = vec3f( 0.0 );
					var lightEvalPdf = 0.0;
					var bounceOrigin = position;
					var shadowOrigin = position;
					var shadowStack = medium.stack;
					var emission = vec3f( 0.0 );
					var isTerminated = false;

					// the hit as staged by the wavefront. A fog scatter has no surface
					var hit: ${ hitRecordStruct };
					hit.bounce = bounce;

					if ( isFogScatter ) {

						// a fog scatter. The phase function is its own pdf. Out of fog bounces the path ends here
						lightEvalPdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, lightRec.direction ), medium.anisotropy );
						lightEvalColor = vec3f( lightEvalPdf );
						scatterRec.direction = ${ sampleHenyeyGreensteinFn }( ray.direction, medium.anisotropy, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ) );
						scatterRec.pdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, scatterRec.direction ), medium.anisotropy );
						scatterRec.color = vec3f( scatterRec.pdf );
						isTerminated = fogBounces >= maxFogBounces;
						isFullyTransmissive = false;
						fogBounces ++;

					} else {

						hit.barycoord = hitResult.barycoord;
						hit.objectIndex = i32( hitResult.objectIndex );
						hit.normal = hitResult.normal;
						hit.side = hitResult.side;
						hit.indices = hitResult.indices.xyz;
						hit.dist = hitResult.dist;

						// whole structs, not pointer aliases, which Safari fails to compile
						let objectInfo = ${ transformsStorage }[ hit.objectIndex ];
						let materialInfo = ${ materialsStorage }[ objectInfo.materialIndex ];

						var vertexData = ${ sampleTrianglePointFn }( hit.barycoord, hit.indices );
						vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
						vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
						vertexData.position = objectInfo.matrixWorld * vertexData.position;

						let view = - ray.direction;

						// blur glossy surfaces after low pdf bounces, Cycles' filter glossy
						let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * minPdf, 0.0, 1.0 ) ) * 0.5;

						var surface = ${ getSurfaceRecordFn }( materialInfo, objectInfo.color, vertexData, hit, view, blurRoughness );

						// a matte surface hit by the camera renders transparent. Lights passed stay, added after the loop
						let isMatte = surface.matte && hit.bounce == 0u;
						if ( isMatte ) {

							resultColor = vec4f( 0.0 );
							break;

						}

						// pass through partially transparent surfaces by chance, and fog boundaries always, advancing the
						// alpha depth but not the bounce
						let isFogBoundary = materialInfo.fogVolume != 0;
						let passesThrough = isFogBoundary || ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity;
						if ( passesThrough ) {

							// out of transparent bounces
							if ( alphaDepth >= maxTransparentBounces ) {

								break;

							}

							if ( isFogBoundary ) {

								var stack = medium.stack;
								if ( hit.side > 0.0 ) {

									${ addToMediumStackFn }( &stack, objectInfo.materialIndex );

								} else {

									${ removeFromMediumStackFn }( &stack, objectInfo.materialIndex );

								}

								medium = ${ getCombinedMediumFn }( stack );

							}

							// restart the traversal past the surface. The ray keeps its origin
							traceOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, ray.direction, hit.normal );
							maxDist = max( maxDist - hit.dist, 0.0 );
							rayStart += hit.dist;
							alphaDepth ++;
							${ rngNextBounce }();
							bounce --;
							continue;

						}

						// dispersion, with the hero wavelength's weight applied at the first dispersive hit
						let isDispersive = surface.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
						if ( isDispersive ) {

							let wavelength = abs( dispersionWavelength );
							${ applyDispersionFunc }( &surface, surface.dispersion, wavelength );
							if ( dispersionWavelength < 0.0 ) {

								dispersionWavelength = wavelength;
								throughputColor *= ${ dispersionColorWeightFunc }( wavelength );

							}

						}

						// emission, gathered below
						emission = surface.emission;

						// evaluate the bsdf toward the light. The pdf is 0 without NEE
						if ( lightRec.pdf > 0.0 ) {

							let evalRec = ${ bsdfEvalPdfFn }( hit, surface, view, lightRec.direction );
							lightEvalColor = evalRec.color;
							lightEvalPdf = evalRec.pdf;
							shadowOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, lightRec.direction, hit.normal );
							shadowStack = ${ getShadowMediumStackFn }(
								medium.stack, objectInfo.materialIndex, hit.side, surface.thinWall,
								ray.direction, lightRec.direction, hit.normal,
							);

						}

						// sample the next bounce direction
						scatterRec = ${ bsdfSampleFn }( hit, surface, view );

						// the denoiser's albedo and normal, from the first scatter
						if ( ! auxFound ) {

							auxFound = ${ isAuxSurfaceFn }( surface, scatterRec );
							auxAlbedo = saturate( throughputColor * surface.color );
							auxNormal = surface.normal;

						}

						isTerminated = all( scatterRec.color == vec3f( 0.0 ) ) || ${ isTerminatingScatterFunc }( scatterRec );
						isFullyTransmissive = isFullyTransmissive && scatterRec.isTransmissive;

						// track the smallest pdf seen along the path for the glossy filter
						minPdf = min( minPdf, scatterRec.pdf );

						// refracting through a volume's surface enters or exits it
						if ( scatterRec.isTransmissive && ! surface.thinWall ) {

							var stack = medium.stack;
							if ( hit.side > 0.0 ) {

								${ addToMediumStackFn }( &stack, objectInfo.materialIndex );

							} else {

								${ removeFromMediumStackFn }( &stack, objectInfo.materialIndex );

							}

							// a subsurface volume isn't on the stack, refracting into one starts a walk through it
							medium = ${ getCombinedMediumFn }( stack );
							if ( hit.side > 0.0 && ${ isSubsurfaceMaterialFn }( objectInfo.materialIndex ) ) {

								medium = ${ getSubsurfaceMediumFn }( objectInfo.materialIndex );
								medium.stack = stack;

							}

						}

						bounceOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, hit.normal );

					}

					// finished paths skip the bounce but still gather the vertex's light below
					let newBounce = hit.bounce + 1u;
					isTerminated = isTerminated || newBounce >= maxBounces;

					// russian roulette from the fourth vertex on, "hit.bounce" being zero at the camera hit in both
					// backends. Matches Cycles path_state_continuation_probability
					if ( ! isTerminated && hit.bounce >= 3u ) {

						let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
						let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
						isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
						if ( ! isTerminated ) {

							// fold the survival boost into the scatter color
							scatterRec.color /= rrProb;

						}

					}

					// LogicKernel, resolving the vertex on its next pass
					// the vertex's light sample and emission, with the pre-scatter throughput, clamped at the segment's depth
					if ( lightRec.pdf > 0.0 ) {

						let contribution = ${ getLightContributionFn }( lightRec, lightEvalColor, lightEvalPdf, shadowOrigin, shadowStack, throughputColor, bounce, maxBounces );
						resultColor += vec4f( contribution, 0.0 );

					}

					resultColor += vec4f( ${ clampPathContributionFunc }( throughputColor * emission, bounce ), 0.0 );

					if ( isTerminated ) {

						break;

					}

					// apply the scatter across the next segment
					throughputColor *= scatterRec.color / scatterRec.pdf;
					scatterPdf = scatterRec.pdf;
					mediumScattered = false;
					if ( all( throughputColor == vec3f( 0.0 ) ) ) {

						break;

					}

					// MaterialKernel
					// the next segment starts at the bounce origin
					ray.origin = bounceOrigin;
					ray.direction = scatterRec.direction;
					rayStart = 0.0;
					maxDist = 0.0;
					traceOrigin = ray.origin;

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
