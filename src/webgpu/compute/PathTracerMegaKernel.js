import { DataTexture, Vector2 } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './targets.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { blendAuxFn, isAuxSurfaceFn, AUX_LAYERS } from '../nodes/aux.wgsl.js';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_ALPHA_TEST, RNG_INDEX_MEDIUM_DISTANCE, RNG_INDEX_MEDIUM_DIRECTION, RNG_INDEX_VOLUME_LIGHT_POINT, RNG_INDEX_VOLUME_DIRECT_LIGHT } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn, sampleHenyeyGreensteinFn, henyeyGreensteinPdfFn } from '../nodes/sampling.wgsl.js';
import { mediumStackEnterFunc, mediumStackExitFunc, stackMediumFunc, shadowMediumStackFunc, shadowTransmittanceFunc, originMediumStackFunc, sampleVolumeLightPointFn, getLightPointFn, mediumChannelPdfFn, sampleMediumDistanceFn, mediumDistancePdfFn, MEDIUM_THROUGHPUT_EPSILON, MEDIUM_STACK_EMPTY } from '../nodes/medium.wgsl.js';
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
			maxSubsurfaceBounces: uniform( 256, 'uint' ),
			maxFogBounces: uniform( 0, 'uint' ),
			misEnabled: uniform( 1, 'uint' ),
			maxSamples: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			// whether the scene has volumes, which camera rays then trace for the ones they start inside of
			hasVolumes: uniform( 0, 'uint' ),

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
		const mediumStackExitFn = mediumStackExitFunc( transformsNode );
		const stackMediumFn = stackMediumFunc( transformsNode, materialsNode );
		const shadowMediumStackFn = shadowMediumStackFunc( mediumStackEnterFn, mediumStackExitFn );
		const shadowTransmittanceFn = shadowTransmittanceFunc( transformsNode, materialsNode );
		const originMediumStackFn = originMediumStackFunc( raycastFirstHitFn, raycastOutput, offsetRayOriginFunc, transformsNode, materialsNode, mediumStackEnterFn );

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

		// The point a light sampled from a surface the path passes through reaches, for the fog segment after it
		// to draw equiangular samples toward, matching the light the wavefront kernels sample at every hit
		const sampleLightPointFn = wgslTagFn/* wgsl */`

			fn sampleLightPoint( position: vec3f, envWeight: f32, ruv: vec3f, current: vec4f ) -> vec4f {

				var selectionPdf = 0.0;
				let lightIndex = ${ selectLightFn }( position, envWeight, ruv.x, &selectionPdf );
				if ( selectionPdf <= 0.0 ) {

					return current;

				}

				if ( lightIndex >= ${ lightsCountNode } ) {

					return vec4f( 0.0 );

				}

				let lightRec = ${ randomLightSampleFn }( lightIndex, position, ruv.yz );
				return select( current, ${ getLightPointFn }( position, lightRec ), lightRec.pdf > 0.0 );

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
				seed: u32,
				maxBounces: u32,
				maxTransparentBounces: u32,
				maxSubsurfaceBounces: u32,
				maxFogBounces: u32,
				misEnabled: u32,
				maxSamples: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,
				hasVolumes: u32,

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

				// Alpha pass throughs only move where the BVH traversal starts, "rayStart" along the ray, so the
				// ray keeps the origin it scattered from, which its MIS weights are measured from
				var rayStart = 0.0;
				var traceOrigin = ray.origin;
				var isFullyTransmissive = true;
				var minPdf = 1.0;
				var transparentBounce = 0u;

				// the media the path is inside of, starting from those around the ray's origin
				var originStack = vec4u( ${ MEDIUM_STACK_EMPTY }u );
				if ( hasVolumes != 0u ) {

					originStack = ${ originMediumStackFn }( ray.origin );

				}

				var medium = ${ stackMediumFn }( originStack, ${ MEDIUM_STACK_EMPTY }u );
				var subsurfaceBounces = 0u;
				var fogBounces = 0u;

				// the point the last light sample reached, which fog segments draw equiangular samples toward
				var lightPoint = vec4f( 0.0 );

				// no light is sampled at a subsurface scatter event, so whatever the next segment reaches takes full weight
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

					// Inside a medium, sample a scatter event before the next surface. A subsurface walk only traces
					// up to it, while a fog segment's light point needs the full distance to the surface
					var channelPdf = vec3f( 0.0 );
					var scatterDist = 0.0;
					var traceRay = ray;
					traceRay.origin = traceOrigin;
					if ( medium.inside ) {

						channelPdf = ${ mediumChannelPdfFn }( throughputColor, medium.albedo );
						scatterDist = ${ sampleMediumDistanceFn }( medium, channelPdf, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DISTANCE } ) );
						if ( ! medium.fog ) {

							traceRay.maxDist = select( scatterDist, min( ray.maxDist, scatterDist ), ray.maxDist > 0.0 );

						}

					}

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( traceRay, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					let segmentInMedium = medium.inside;
					var segmentEnd = surfaceDist;
					var fogScatter = false;
					if ( medium.inside ) {

						let scattered = scatterDist < surfaceDist;
						let segmentDist = select( surfaceDist, scatterDist, scattered );
						let transmittance = exp( - medium.extinction * segmentDist );
						let distancePdf = dot( channelPdf, ${ mediumDistancePdfFn }( medium, segmentDist, scattered ) );
						if ( distancePdf <= 0.0 ) {

							break;

						}

						// light scattered toward the path from a point on a fog segment, sampled at the point
						if ( medium.fog && misEnabled != 0u ) {

							var pointDist = 0.0;
							let pointWeight = ${ sampleVolumeLightPointFn }(
								medium, channelPdf, scatterDist, surfaceDist, traceOrigin, ray.direction, lightPoint,
								${ rand2 }( ${ RNG_INDEX_VOLUME_LIGHT_POINT } ), &pointDist,
							);

							if ( any( pointWeight > vec3f( 0.0 ) ) ) {

								let position = traceOrigin + ray.direction * pointDist;
								let ruv = ${ rand3 }( ${ RNG_INDEX_VOLUME_DIRECT_LIGHT } );
								var selectionPdf = 0.0;
								let lightIndex = ${ selectLightFn }( position, envWeight, ruv.x, &selectionPdf );
								if ( selectionPdf > 0.0 ) {

									var lightRec: ${ lightRecordStruct };
									if ( envActive && lightIndex == lightsCount ) {

										let envSample = ${ sampleEnvDir }( ruv.yz );
										lightRec.direction = envSample.direction;
										lightRec.emission = envSample.color;
										lightRec.pdf = envSample.pdf;
										lightRec.dist = ${ LIGHT_FAR_DISTANCE };
										lightRec.lightType = ${ ENVIRONMENT_LIGHT_TYPE };

									} else {

										lightRec = ${ randomLightSampleFn }( lightIndex, position, ruv.yz );

									}

									if ( lightRec.pdf > 0.0 ) {

										lightPoint = ${ getLightPointFn }( position, lightRec );

										var shadowRay: ${ rayStruct };
										shadowRay.origin = position;
										shadowRay.direction = lightRec.direction;
										shadowRay.maxDist = lightRec.dist * ( 1.0 - ${ LIGHT_EPSILON } );

										var shadowHit: ${ raycastOutput };
										let occluded = ${ raycastShadowFn }( shadowRay, &shadowHit );
										if ( ! occluded ) {

											// the phase function is its own pdf
											let lightPdf = lightRec.pdf * selectionPdf;
											let lightTransmittance = ${ shadowTransmittanceFn }( medium.stack, shadowRay.maxDist, shadowHit.fogDepth, shadowHit.occlusion );
											let phasePdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, lightRec.direction ), medium.anisotropy );
											let isMISWeightedLight = ${ isMISWeightLightFn }( lightRec.lightType );
											let misWeight = select( 1.0, mix( ${ misHeuristicFn }( lightPdf, phasePdf ), 1.0, shadowHit.skippedOcclusion ), isMISWeightedLight );
											let directLight = throughputColor * pointWeight * lightRec.emission * lightTransmittance * phasePdf * misWeight / lightPdf;
											let contribution = ${ clampPathContributionFunc }( directLight, bounce + 1u, clampDirect, clampIndirect );
											resultColor += vec4f( contribution, 0.0 );

										}

									}

								}

							}

						}

						if ( ! scattered ) {

							// reaching the surface, weighted by the probability of no scatter event before it
							throughputColor *= transmittance / distancePdf;

						} else if ( medium.fog ) {

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

					// NEE's total weight at the vertex this ray left, for MIS. Camera rays have none, and
					// neither do scatter events in a subsurface walk
					let isMISWeighted = misEnabled != 0u && bounce > 0u && ! mediumScattered;
					var lightTotalWeight = 0.0;
					if ( isMISWeighted ) {

						lightTotalWeight = ${ getLightsWeightFn }( ray.origin ) + envWeight;

					}

					// forward hits on area lights along the traced segment. Camera rays only see visibleToCameraRays
					// lights, at full weight
					for ( var li = 0u; li < lightsCount; li ++ ) {

						if ( bounce == 0u && ! ${ isLightVisibleToCameraFn }( li ) ) {

							continue;

						}

						var lightRec: ${ lightRecordStruct };
						if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist > rayStart && lightRec.dist < rayStart + segmentEnd ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								let selectionPdf = ${ getLightWeightFn }( li, ray.origin ) / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( bsdfPdf, lightRec.pdf * selectionPdf );

							}

							lightHits += ${ clampPathContributionFunc }( lightRec.emission * throughputColor * misWeight, bounce, clampDirect, clampIndirect );
							cameraHitLight = cameraHitLight || bounce == 0u;

						}

					}

					// A scatter event in fog is a path vertex like a surface, counted as a bounce. Its light was
					// sampled with the segment's above
					if ( fogScatter ) {

						// out of fog bounces the path ends here, keeping the light sampled at the scatter
						if ( fogBounces >= maxFogBounces ) {

							break;

						}

						fogBounces ++;
						ray.origin = traceOrigin + ray.direction * segmentEnd;
						traceOrigin = ray.origin;
						rayStart = 0.0;
						ray.maxDist = 0.0;

						// russian roulette, as at a surface. The phase function's sample weight is one
						if ( bounce >= 3u ) {

							let rrProb = saturate( sqrt( max( max( throughputColor.r, throughputColor.g ), throughputColor.b ) ) );
							if ( rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

								break;

							}

							throughputColor /= rrProb;

						}

						let newDirection = ${ sampleHenyeyGreensteinFn }( ray.direction, medium.anisotropy, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ) );
						bsdfPdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, newDirection ), medium.anisotropy );
						ray.direction = newDirection;
						mediumScattered = false;

						${ rngNextBounce }();
						continue;

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
						// the traversal at the hit point, advancing the rng but not the bounce count. A fog
						// volume's boundary is always passed, entering or leaving its volume
						let isFogBoundary = materialInfo.fogVolume != 0;
						if ( isFogBoundary || ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity ) {

							// stop once the transparent bounces run out
							transparentBounce ++;
							if ( transparentBounce > maxTransparentBounces ) {

								break;

							}

							if ( isFogBoundary ) {

								var stack: vec4u;
								if ( hitResult.side > 0.0 ) {

									stack = ${ mediumStackEnterFn }( medium.stack, hitResult.objectIndex );

								} else {

									stack = ${ mediumStackExitFn }( medium.stack, hitResult.objectIndex );

								}

								if ( any( stack != medium.stack ) ) {

									medium = ${ stackMediumFn }( stack, hitResult.objectIndex );

								}

							}

							if ( misEnabled != 0u ) {

								lightPoint = ${ sampleLightPointFn }( vertexData.position.xyz, envWeight, ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ), lightPoint );

							}

							traceOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, ray.direction, hitResult.normal );
							rayStart += hitResult.dist;
							${ rngNextBounce }();
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

									lightPoint = ${ getLightPointFn }( vertexData.position.xyz, lightRec );

									let evalRec = ${ bsdfEvalPdfFn }( view, lightRec.direction, surface );
									if ( evalRec.pdf > 0.0 ) {

										var shadowRay: ${ rayStruct };
										shadowRay.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, lightRec.direction, hitResult.normal );
										shadowRay.direction = lightRec.direction;
										shadowRay.maxDist = lightRec.dist * ( 1.0 - ${ LIGHT_EPSILON } );

										// opaque occlusion up to the light distance, attenuated by the partially
										// transparent surfaces and the volumes passed
										var shadowHit: ${ raycastOutput };
										let occluded = ${ raycastShadowFn }( shadowRay, &shadowHit );
										if ( ! occluded ) {

											let lightPdf = lightRec.pdf * selectionPdf;
											let shadowStack = ${ shadowMediumStackFn }( medium.stack, hitResult.objectIndex, hitResult.side, surface.thinWall, ray.direction, lightRec.direction, hitResult.normal );
											let lightTransmittance = ${ shadowTransmittanceFn }( shadowStack, shadowRay.maxDist, shadowHit.fogDepth, shadowHit.occlusion );

											// env + area lights are also found by bsdf rays, so MIS-weight them. Punctual lights, and lights
											// past the bounce limit, take full weight. Bsdf rays stopped by faces the shadow ray skipped can't
											// find the light, so their share of the weight moves to the light sample
											let isMISWeighted = ${ isMISWeightLightFn }( lightRec.lightType ) && bounce + 1u < maxBounces;
											let misWeight = select( 1.0, mix( ${ misHeuristicFn }( lightPdf, evalRec.pdf ), 1.0, shadowHit.skippedOcclusion ), isMISWeighted );
											let directLight = throughputColor * lightRec.emission * lightTransmittance * evalRec.color * misWeight / lightPdf;
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

								medium = ${ stackMediumFn }( stack, hitResult.objectIndex );

							}

						}

						// exit if our throughput is 0.0
						if ( all( throughputColor == vec3f( 0.0 ) ) ) {

							break;

						}

						ray.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, hitResult.normal );
						ray.direction = scatterRec.direction;
						ray.maxDist = 0.0;
						traceOrigin = ray.origin;
						rayStart = 0.0;

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
