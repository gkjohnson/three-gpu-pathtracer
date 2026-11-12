import { DataTexture, Vector2 } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './targets.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { blendAuxFn, isAuxSurfaceFn, AUX_LAYERS } from '../nodes/auxiliary.wgsl.js';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_ALPHA_TEST, RNG_INDEX_MEDIUM_DISTANCE, RNG_INDEX_MEDIUM_DIRECTION } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn, sampleHenyeyGreensteinFn, henyeyGreensteinPdfFn } from '../nodes/sampling.wgsl.js';
import {
	mediumStackStruct, addToMediumStackFn, removeFromMediumStackFn, getCombinedMediumFn, getSubsurfaceMediumFn, isSubsurfaceMaterialFn,
	getMediumStackAtPointFn, getShadowMediumStackFn, getShadowMediumDepthFn, getShadowTransmittanceFn, getMediumChannelPdfFn,
	sampleMediumDistanceFn, getMediumDistancePdfFn, MEDIUM_THROUGHPUT_EPSILON,
} from '../nodes/medium.wgsl.js';
import { proxy, proxyFn, contextProxy, contextProxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc } from '../nodes/utils.wgsl.js';
import { lightRecordStruct, hitRecordStruct, scatterRecordStruct } from '../nodes/structs.wgsl.js';
import { LIGHT_FAR_DISTANCE, LIGHT_EPSILON, isMISWeightLightFn } from '../nodes/lights.wgsl.js';
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
			maxBounces: uniform( 5 ),
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
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const getLightHitsFn = proxyFn( 'lightsInfo.value.getLightHits', params );
		const getEnvironmentPdfFn = proxyFn( 'lightsInfo.value.getEnvironmentPdf', params );
		const sampleLightFn = proxyFn( 'lightsInfo.value.sampleLight', params );

		// Returns the light a light sample adds at a path vertex, given the vertex evaluated toward the light. The
		// shadow ray starts at the origin in the given media, attenuated by the partially transparent surfaces and the
		// volumes passed
		const getLightContributionFn = wgslTagFn/* wgsl */`
			fn getLightContribution(
				lightRec: ${ lightRecordStruct }, evalColor: vec3f, evalPdf: f32, origin: vec3f, stack: ${ mediumStackStruct },
				throughput: vec3f, bounce: u32, maxBounces: u32,
			) -> vec3f {

				if ( evalPdf <= 0.0 ) {

					return vec3f( 0.0 );

				}

				var shadowRay: ${ rayStruct };
				shadowRay.origin = origin;
				shadowRay.direction = lightRec.direction;
				shadowRay.maxDist = lightRec.dist * ( 1.0 - ${ LIGHT_EPSILON } );

				// opaque occlusion up to the light distance
				var shadowHit: ${ raycastOutput };
				if ( ${ raycastShadowFn }( shadowRay, &shadowHit ) ) {

					return vec3f( 0.0 );

				}

				let mediumDepth = ${ getShadowMediumDepthFn }( stack, shadowRay.maxDist );
				let lightTransmittance = ${ getShadowTransmittanceFn }( mediumDepth + shadowHit.fogDepth, shadowHit.occlusion );

				// env + area lights are also found by bsdf rays, so MIS-weight them. Punctual lights, and lights
				// past the bounce limit, take full weight. Bsdf rays stopped by faces the shadow ray skipped can't
				// find the light, so their share of the weight moves to the light sample
				let isMISWeighted = ${ isMISWeightLightFn }( lightRec.lightType ) && bounce + 1u < maxBounces;
				let misWeight = select( 1.0, mix( ${ misHeuristicFn }( lightRec.pdf, evalPdf ), 1.0, shadowHit.skippedOcclusion ), isMISWeighted );
				let directLight = throughput * lightRec.emission * lightTransmittance * evalColor * misWeight / lightRec.pdf;
				return ${ clampPathContributionFunc }( directLight, bounce + 1u );

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

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var bsdfPdf = 0.0;

				// Alpha pass throughs only move where the BVH traversal starts, "rayStart" along the ray, so the
				// ray keeps the origin it scattered from, which its MIS weights are measured from
				var rayStart = 0.0;
				var traceOrigin = ray.origin;
				var isFullyTransmissive = true;
				var minPdf = 1.0;
				var transparentBounce = 0u;

				// get the set of mediums that the camera ray starts within
				var medium = ${ getCombinedMediumFn }( ${ getMediumStackAtPointFn }( ray.origin ) );
				var subsurfaceBounces = 0u;
				var fogBounces = 0u;

				// no light is sampled at a subsurface scatter event, so whatever the next segment reaches takes full weight
				var mediumScattered = false;

				// A negative value marks a sampled wavelength whose RGB reconstruction weight has not been applied yet.
				var dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );

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

					// Inside a medium, sample a scatter event before the next surface and only trace up to it
					var channelPdf = vec3f( 0.0 );
					var scatterDist = 0.0;
					var traceRay = ray;
					traceRay.origin = traceOrigin;
					if ( medium.scatters != 0u ) {

						channelPdf = ${ getMediumChannelPdfFn }( throughputColor, medium.albedo );
						scatterDist = ${ sampleMediumDistanceFn }( medium, channelPdf, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DISTANCE } ) );
						traceRay.maxDist = select( scatterDist, min( ray.maxDist, scatterDist ), ray.maxDist > 0.0 );

					}

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( traceRay, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					let segmentInMedium = medium.scatters != 0u;
					var segmentEnd = surfaceDist;
					var fogScatter = false;
					if ( segmentInMedium ) {

						let scattered = scatterDist < surfaceDist;
						let segmentDist = select( surfaceDist, scatterDist, scattered );
						let transmittance = exp( - medium.extinction * segmentDist );
						let distancePdf = dot( channelPdf, ${ getMediumDistancePdfFn }( medium, segmentDist, scattered ) );
						if ( distancePdf <= 0.0 ) {

							break;

						}

						if ( ! scattered ) {

							// reaching the surface, weighted by the probability of no scatter event before it
							throughputColor *= transmittance / distancePdf;

						} else if ( medium.subsurface == 0u ) {

							// a scatter event in fog is a path vertex, resolved once the lights before it are found
							throughputColor *= medium.albedo * medium.extinction * transmittance / distancePdf;
							isFullyTransmissive = false;
							fogScatter = true;
							segmentEnd = scatterDist;

						} else {

							throughputColor *= medium.albedo * medium.extinction * transmittance / distancePdf;
							ray.origin = traceOrigin + ray.direction * scatterDist;
							traceOrigin = ray.origin;
							rayStart = 0.0;
							ray.direction = ${ sampleHenyeyGreensteinFn }( ray.direction, medium.anisotropy, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ) );
							ray.maxDist = 0.0;
							mediumScattered = true;
							isFullyTransmissive = false;

							// subsurface bounces are capped separately from bounces
							subsurfaceBounces ++;
							let maxThroughput = max( max( throughputColor.r, throughputColor.g ), throughputColor.b );
							if ( subsurfaceBounces >= maxSubsurfaceBounces || maxThroughput < ${ MEDIUM_THROUGHPUT_EPSILON } ) {

								break;

							}

							${ rngNextBounce }();
							bounce --;
							continue;

						}

					}

					// MIS weights against the light sampling at the vertex this ray left. Camera rays have none, and
					// neither do scatter events in a subsurface walk
					let isMISWeighted = misEnabled != 0u && bounce > 0u && ! mediumScattered;

					// forward hits on area lights along the traced segment, which starts "rayStart" along the ray
					let segmentLight = ${ getLightHitsFn }( ray.origin, ray.direction, rayStart, rayStart + segmentEnd, throughputColor, bsdfPdf, isMISWeighted, bounce );
					lightHits += segmentLight.rgb;
					cameraHitLight = cameraHitLight || ( bounce == 0u && segmentLight.a > 0.0 );

					// next event estimation: choose one light or the environment by its estimated
					// contribution. The vertex below evaluates the bsdf, or the phase function at a scatter
					// event in fog, toward it
					var lightRec: ${ lightRecordStruct };
					if ( misEnabled != 0u && ( fogScatter || didHit ) ) {

						let position = traceOrigin + ray.direction * segmentEnd;
						lightRec = ${ sampleLightFn }( position, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

					}

					// The vertex's next direction, its evaluation toward the light sampled above, and where the
					// bounce and shadow rays start
					var scatterRec: ${ scatterRecordStruct };
					var lightEvalColor = vec3f( 0.0 );
					var lightEvalPdf = 0.0;
					var bounceOrigin = vec3f( 0.0 );
					var shadowOrigin = vec3f( 0.0 );
					var shadowStack = medium.stack;
					var isTerminated = false;
					if ( fogScatter ) {

						// A scatter event in fog. The phase function is its own pdf, so a sample's weight is one. Out
						// of fog bounces the path ends here, keeping the light sampled at it
						bounceOrigin = traceOrigin + ray.direction * segmentEnd;
						shadowOrigin = bounceOrigin;
						lightEvalPdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, lightRec.direction ), medium.anisotropy );
						lightEvalColor = vec3f( lightEvalPdf );
						scatterRec.direction = ${ sampleHenyeyGreensteinFn }( ray.direction, medium.anisotropy, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ) );
						scatterRec.pdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, scatterRec.direction ), medium.anisotropy );
						scatterRec.color = vec3f( scatterRec.pdf );
						isTerminated = fogBounces >= maxFogBounces;
						fogBounces ++;

					} else if ( didHit ) {

						// the hit, recorded as in the wavefront ray data
						var hit: ${ hitRecordStruct };
						hit.barycoord = hitResult.barycoord;
						hit.objectIndex = i32( hitResult.objectIndex );
						hit.normal = hitResult.normal;
						hit.side = hitResult.side;
						hit.indices = hitResult.indices.xyz;
						hit.dist = hitResult.dist;
						hit.bounce = bounce;

						// whole structs are read from the buffer, not a pointer alias, which Safari fails to compile
						let objectInfo = ${ transformsStorage }[ hit.objectIndex ];
						let materialInfo = ${ materialsStorage }[ objectInfo.materialIndex ];

						let view = - ray.direction;
						var vertexData = ${ sampleTrianglePointFn }( hit.barycoord, hit.indices );
						vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
						vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
						vertexData.position = objectInfo.matrixWorld * vertexData.position;

						// blur glossy surfaces after low-probability bounces to suppress fireflies,
						// from the Cycles "filter glossy" approach in integrator/surface_shader.h
						// The smallest pdf seen along the path for the glossy filter is tracked below
						let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * minPdf, 0.0, 1.0 ) ) * 0.5;

						var surface = ${ getSurfaceRecordFn }( materialInfo, objectInfo.color, vertexData, hit, view, blurRoughness );

						// a matte surface hit by the camera ray renders as a fully transparent
						if ( surface.matte && bounce == 0u ) {

							resultColor = vec4f( 0.0 );
							break;

						}

						// a medium that only absorbs attenuates the segment to the hit
						if ( ! segmentInMedium && any( medium.extinction > vec3f( 0.0 ) ) ) {

							throughputColor *= exp( - medium.extinction * hit.dist );

						}

						// Stochastically pass through partially transparent surfaces by restarting
						// the traversal at the hit point, advancing the rng but not the bounce count. A fog
						// volume's boundary is always passed, entering or leaving its volume
						let isFogBoundary = materialInfo.fogVolume != 0;
						if ( isFogBoundary || ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity ) {

							// stop once the transparent bounces run out
							if ( transparentBounce >= maxTransparentBounces ) {

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

							traceOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, ray.direction, hit.normal );
							rayStart += hit.dist;
							${ rngNextBounce }();
							transparentBounce ++;
							bounce --;
							continue;

						}

						let isDispersive = surface.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
						if ( isDispersive ) {

							let wavelength = abs( dispersionWavelength );
							${ applyDispersionFunc }( &surface, surface.dispersion, wavelength );
							if ( dispersionWavelength < 0.0 ) {

								dispersionWavelength = wavelength;
								throughputColor *= ${ dispersionColorWeightFunc }( wavelength );

							}

						}

						// emission, clamped at the depth of the segment that found it, as in Cycles
						let emission = ${ clampPathContributionFunc }( throughputColor * surface.emission, bounce );
						resultColor += vec4f( emission, 0.0 );

						// evaluate the bsdf toward the light sampled above. The light pdf is 0 if NEE is disabled
						if ( lightRec.pdf > 0.0 ) {

							let evalRec = ${ bsdfEvalPdfFn }( hit, surface, view, lightRec.direction );
							lightEvalColor = evalRec.color;
							lightEvalPdf = evalRec.pdf;
							shadowOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, lightRec.direction, hit.normal );
							shadowStack = ${ getShadowMediumStackFn }( medium.stack, objectInfo.materialIndex, hit.side, surface.thinWall, ray.direction, lightRec.direction, hit.normal );

						}

						scatterRec = ${ bsdfSampleFn }( hit, surface, view );

						if ( ! auxFound ) {

							auxFound = ${ isAuxSurfaceFn }( surface, scatterRec );
							auxAlbedo = saturate( throughputColor * surface.color );
							auxNormal = surface.normal;

						}

						isTerminated = ${ isTerminatingScatterFunc }( scatterRec );
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

					} else {

						if ( bounce > 0u && ! isFullyTransmissive ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								// weighted against the light sampling choosing the environment
								let envPdf = ${ getEnvironmentPdfFn }( ray.origin, ray.direction );
								misWeight = select( 1.0, ${ misHeuristicFn }( bsdfPdf, envPdf ), envPdf > 0.0 );

							}

							let environment = ${ sampleEnvColor }( ray.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, bounce );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( ray.direction, rng );
							if ( bounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, bounce );
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
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * envMisWeight, bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * envMisWeight, bounce );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * envMisWeight;
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

					// the light sampled at the vertex, through its shadow ray. A finished path still gathers it
					if ( lightRec.pdf > 0.0 ) {

						let contribution = ${ getLightContributionFn }( lightRec, lightEvalColor, lightEvalPdf, shadowOrigin, shadowStack, throughputColor, bounce, maxBounces );
						resultColor += vec4f( contribution, 0.0 );

					}

					if ( isTerminated ) {

						break;

					}

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

					// exit if our throughput is 0.0
					if ( all( throughputColor == vec3f( 0.0 ) ) ) {

						break;

					}

					ray.origin = bounceOrigin;
					ray.direction = scatterRec.direction;
					ray.maxDist = 0.0;
					traceOrigin = ray.origin;
					rayStart = 0.0;

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
