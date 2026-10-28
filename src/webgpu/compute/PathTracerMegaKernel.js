import { DataTexture, Vector2 } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { createOutputTarget, createSampleCountTarget } from './targets.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { rngInit, rngNextBounce, rand1, rand2, rand3, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_ALPHA_TEST, RNG_INDEX_MEDIUM_DISTANCE, RNG_INDEX_MEDIUM_DIRECTION, RNG_INDEX_MEDIUM_GUIDE } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn, sampleHenyeyGreensteinFn, sampleHemisphereFn, henyeyGreensteinPdfFn, directionFromCosineFn, dwivediPhasePdfFn, sampleDwivediPhaseFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn, contextProxy, contextProxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc } from '../nodes/utils.wgsl.js';
import { lightRecordStruct } from '../nodes/structs.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, LIGHT_EPSILON, isMISWeightLightFn } from '../nodes/lights.wgsl.js';
import { applyDispersionFunc, dispersionColorWeightFunc, DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH, transmissionAttenuationFunc } from '../nodes/material.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../constants.js';

// scatter events a path may take inside a medium, which don't count against the bounce limit
const MEDIUM_MAX_STEPS = 256;

// the smallest attenuation color used to derive a medium's extinction, keeping the log finite
const MEDIUM_MIN_ATTENUATION = 1e-6;

// the throughput below which a walk stops, matching Cycles' VOLUME_THROUGHPUT_EPSILON
const MEDIUM_THROUGHPUT_EPSILON = 1e-6;

// the largest single scatter albedo used for the guiding diffusion length, which is infinite at one, as in Cycles
const MEDIUM_MAX_GUIDING_ALBEDO = 0.999999;

// how many of the shortest mean free paths the first segment looks for the opposite interface, as in Cycles
const MEDIUM_OPPOSITE_SEARCH_PATHS = 10;

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

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastFirstHitFn = contextProxyFn( 'bvhData.fns.raycastFirstHit' );
		const raycastShadowFn = contextProxyFn( 'bvhData.fns.raycastShadow' );
		const sampleTrianglePointFn = contextProxyFn( 'bvhData.fns.sampleTrianglePoint' );
		const getSurfaceRecordFn = contextProxyFn( 'bvhData.fns.getSurfaceRecord' );
		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

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
				misEnabled: u32,
				maxSamples: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,

				transmissiveBackground: u32,

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

				// the scattering volume the path is inside of, entered by refracting into a material with
				// "KHR_materials_scatter" volume parameters. Media don't nest
				var inMedium = false;
				var mediumExtinction = vec3f( 0.0 );
				var mediumAlbedo = vec3f( 0.0 );
				var mediumAnisotropy = 0.0;
				var mediumSteps = 0u;
				var mediumObject = 0u;

				// Dwivedi guiding, as in Cycles' subsurface_random_walk.h: with the guided fraction, scatter
				// directions and distances are drawn to steer the walk back toward the entry surface, or toward
				// the opposite interface the first segment found, and combined with classic sampling by MIS
				var mediumEntryPosition = vec3f( 0.0 );
				var mediumEntryNormal = vec3f( 0.0 );
				var mediumDiffusionLength = 0.0;
				var mediumPhaseLog = 0.0;
				var mediumGuidedFraction = 0.0;
				var mediumFirstSegment = false;
				var mediumHasOpposite = false;
				var mediumOppositeDistance = 0.0;

				// the guided pdf terms of the current segment, whose direction was drawn at a scatter event
				var segmentGuidable = false;
				var segmentGuided = false;
				var segmentBackward = false;
				var segmentBackwardFraction = 0.0;
				var segmentForwardFactor = 0.0;
				var segmentBackwardFactor = 0.0;
				var segmentForwardStretch = 1.0;
				var segmentBackwardStretch = 1.0;

				// no light is sampled at a scatter event, so whatever the next segment reaches takes full weight
				var mediumScattered = false;

				// As in Cycles, after a diffuse bounce scattering materials shade as diffuse instead of walking
				var diffuseAncestor = false;
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

				for ( var bounce = 0u; bounce < maxBounces; bounce ++ ) {

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( ray, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// Inside a medium, sample a scatter event before the next surface. As in Cycles, following
					// Chiang et al. 2016, the channel is chosen in proportion to throughput times single scatter
					// albedo, and the three channels' distance pdfs are combined with the balance heuristic.
					let segmentInMedium = inMedium;
					if ( inMedium ) {

						let channelWeights = abs( throughputColor * mediumAlbedo );
						let channelWeightSum = channelWeights.r + channelWeights.g + channelWeights.b;
						var channelPdf = vec3f( 1.0 / 3.0 );
						if ( channelWeightSum > 0.0 ) {

							channelPdf = channelWeights / channelWeightSum;

						}

						let distanceSample = ${ rand2 }( ${ RNG_INDEX_MEDIUM_DISTANCE } );
						var channel = 2u;
						if ( distanceSample.x < channelPdf.r ) {

							channel = 0u;

						} else if ( distanceSample.x < channelPdf.r + channelPdf.g ) {

							channel = 1u;

						}

						// a guided segment samples its distance with the extinction stretched along its direction
						var sampleExtinction = mediumExtinction[ channel ];
						if ( segmentGuided ) {

							sampleExtinction *= select( segmentForwardStretch, segmentBackwardStretch, segmentBackward );

						}

						let scatterDist = - log( 1.0 - distanceSample.y ) / sampleExtinction;

						// the first segment looks for the walk's own surface on the far side, for backward guiding
						if ( mediumFirstSegment ) {

							mediumFirstSegment = false;

							let minExtinction = min( min( mediumExtinction.r, mediumExtinction.g ), mediumExtinction.b );
							let searchDist = max( scatterDist, ${ MEDIUM_OPPOSITE_SEARCH_PATHS }.0 / minExtinction );
							if ( didHit && hitResult.objectIndex == mediumObject && hitResult.dist <= searchDist ) {

								mediumHasOpposite = true;
								mediumOppositeDistance = dot( ray.origin + ray.direction * hitResult.dist - mediumEntryPosition, - mediumEntryNormal );

							}

						}

						// the segment pdf, a scatter event's density or the probability of passing to the surface.
						// The classic and guided strategies are combined with the balance heuristic, as in Cycles
						let scattered = scatterDist < surfaceDist;
						let segmentDist = select( surfaceDist, scatterDist, scattered );
						let transmittance = exp( - mediumExtinction * segmentDist );
						var segmentPdf = select( transmittance, mediumExtinction * transmittance, scattered );
						if ( segmentGuidable ) {

							let forwardExtinction = segmentForwardStretch * mediumExtinction;
							let forwardTransmittance = exp( - forwardExtinction * segmentDist );
							let forwardPdf = select( forwardTransmittance, forwardExtinction * forwardTransmittance, scattered );

							let backwardExtinction = segmentBackwardStretch * mediumExtinction;
							let backwardTransmittance = exp( - backwardExtinction * segmentDist );
							let backwardPdf = select( backwardTransmittance, backwardExtinction * backwardTransmittance, scattered );

							let guidedPdf = mix( forwardPdf * segmentForwardFactor, backwardPdf * segmentBackwardFactor, segmentBackwardFraction );
							segmentPdf = mix( segmentPdf, guidedPdf, mediumGuidedFraction );

						}

						let distancePdf = dot( channelPdf, segmentPdf );
						if ( distancePdf <= 0.0 ) {

							break;

						}

						if ( scattered ) {

							throughputColor *= mediumAlbedo * mediumExtinction * transmittance / distancePdf;
							ray.origin += ray.direction * scatterDist;

							// Continue from the scatter event in a direction drawn from the phase function or, with
							// the guided fraction, from Dwivedi's distribution around the entry normal. Backward
							// guiding mirrors it, more often the deeper the walk is toward the opposite interface
							let guideSample = ${ rand2 }( ${ RNG_INDEX_MEDIUM_GUIDE } );
							let directionSample = ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } );
							segmentGuided = guideSample.x < mediumGuidedFraction;
							segmentBackwardFraction = 0.0;
							if ( mediumHasOpposite ) {

								let depth = clamp( dot( ray.origin - mediumEntryPosition, - mediumEntryNormal ), 0.0, mediumOppositeDistance );
								segmentBackwardFraction = 1.0 / ( 1.0 + exp( ( mediumOppositeDistance - 2.0 * depth ) / mediumDiffusionLength ) );

							}

							segmentBackward = guideSample.y < segmentBackwardFraction;

							var newDirection: vec3f;
							var cosTheta: f32;
							if ( segmentGuided ) {

								cosTheta = ${ sampleDwivediPhaseFn }( mediumDiffusionLength, mediumPhaseLog, directionSample.x );
								cosTheta = select( cosTheta, - cosTheta, segmentBackward );
								newDirection = ${ directionFromCosineFn }( mediumEntryNormal, cosTheta, directionSample.y );

							} else {

								newDirection = ${ sampleHenyeyGreensteinFn }( ray.direction, mediumAnisotropy, directionSample );
								cosTheta = dot( newDirection, mediumEntryNormal );

							}

							// the guided direction pdfs relative to the phase function, which cancels in the estimator
							let phasePdf = ${ henyeyGreensteinPdfFn }( dot( ray.direction, newDirection ), mediumAnisotropy );
							segmentForwardFactor = ${ dwivediPhasePdfFn }( mediumDiffusionLength, mediumPhaseLog, cosTheta ) / phasePdf;
							segmentBackwardFactor = ${ dwivediPhasePdfFn }( mediumDiffusionLength, mediumPhaseLog, - cosTheta ) / phasePdf;
							segmentForwardStretch = 1.0 - cosTheta / mediumDiffusionLength;
							segmentBackwardStretch = 1.0 + cosTheta / mediumDiffusionLength;
							segmentGuidable = mediumGuidedFraction > 0.0;

							ray.direction = newDirection;
							ray.maxDist = 0.0;
							mediumScattered = true;
							isFullyTransmissive = false;

							// the walk doesn't count against the bounce limit, but is capped, and ends once its
							// throughput is negligible
							mediumSteps ++;
							let maxThroughput = max( max( throughputColor.r, throughputColor.g ), throughputColor.b );
							if ( mediumSteps >= ${ MEDIUM_MAX_STEPS }u || maxThroughput < ${ MEDIUM_THROUGHPUT_EPSILON } ) {

								break;

							}

							${ rngNextBounce }();
							bounce --;
							continue;

						}

						// reaching the surface, weighted by the probability of no scatter event before it
						throughputColor *= transmittance / distancePdf;

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

					// As in Cycles, the walk ends the first time it reaches its own object's surface and leaves
					// as a diffuse transmission, with no reflection back inside. Other objects shade as usual.
					if ( didHit && segmentInMedium && hitResult.objectIndex == mediumObject ) {

						inMedium = false;

						let hitPosition = ray.origin + ray.direction * hitResult.dist;
						let outward = normalize( hitResult.normal ) * sign( dot( hitResult.normal, ray.direction ) );
						ray.direction = ${ sampleHemisphereFn }( outward, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ) );
						ray.origin = ${ offsetRayOriginFunc }( hitPosition, ray.direction, hitResult.normal );
						ray.maxDist = 0.0;

						// no light is sampled at the exit, so whatever the next segment reaches takes full weight
						mediumScattered = true;
						isFullyTransmissive = false;
						diffuseAncestor = true;

						${ rngNextBounce }();
						continue;

					}

					if ( didHit ) {

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
						if ( diffuseAncestor && ! surface.thinWall && any( materialInfo.scatterColor > vec3f( 0.0 ) ) ) {

							surface.transmission = 0.0;
							surface.color = materialInfo.scatterColor;

						}

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

						// attenuate the light transmitted through the volume when exiting a backface. A scattering
						// medium has already applied its transmittance above
						if ( hitResult.side < 0.0 && materialInfo.transmission > 0.0 && ! segmentInMedium ) {

							throughputColor *= ${ transmissionAttenuationFunc }( hitResult.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

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
											// or when a bsdf ray could never reach the light
											let isMISWeighted = ${ isMISWeightLightFn }( lightRec.lightType ) && ! shadowHit.forwardBlocked;
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
						diffuseAncestor = diffuseAncestor || scatterRec.isDiffuse;

						// a direction from the bsdf isn't guided
						segmentGuidable = false;
						segmentGuided = false;

						// Refracting into a front face of a scattering material starts a random walk inside it. As in
						// Cycles the walk enters along the rough refracted direction.
						if ( scatterRec.isTransmissive && ! surface.thinWall && hitResult.side > 0.0 ) {

							let attenuation = max( materialInfo.attenuationColor, vec3f( ${ MEDIUM_MIN_ATTENUATION } ) );
							let extinction = - log( attenuation ) / materialInfo.attenuationDistance;
							if ( any( materialInfo.scatterAlbedo > vec3f( 0.0 ) ) && any( extinction > vec3f( 0.0 ) ) ) {

								inMedium = true;
								mediumObject = hitResult.objectIndex;
								mediumExtinction = extinction;
								mediumAlbedo = materialInfo.scatterAlbedo;
								mediumAnisotropy = materialInfo.scatterAnisotropy;

								// As in Cycles, the guiding diffusion length comes from the highest albedo (eq. 67 of
								// "Zero-Variance Theory for Efficient Subsurface Scattering", d'Eon and Křivánek 2020),
								// and anisotropic media are guided less
								let maxAlbedo = min( max( max( mediumAlbedo.r, mediumAlbedo.g ), mediumAlbedo.b ), ${ MEDIUM_MAX_GUIDING_ALBEDO } );
								mediumDiffusionLength = 1.0 / sqrt( 1.0 - pow( maxAlbedo, 2.44294 - 0.0215813 * maxAlbedo + 0.578637 / maxAlbedo ) );
								mediumPhaseLog = log( ( mediumDiffusionLength + 1.0 ) / ( mediumDiffusionLength - 1.0 ) );
								mediumGuidedFraction = 1.0 - max( 0.5, pow( abs( mediumAnisotropy ), 0.125 ) );

								// at low albedo the length reaches one and the guided distribution degenerates
								if ( mediumDiffusionLength <= 1.0 ) {

									mediumGuidedFraction = 0.0;

								}

								mediumEntryPosition = vertexData.position.xyz;
								mediumEntryNormal = surface.normal;
								mediumFirstSegment = true;
								mediumHasOpposite = false;

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

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );

	}

}
