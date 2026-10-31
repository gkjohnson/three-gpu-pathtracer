import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxyFn, contextProxy, contextProxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand1, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_ALPHA_TEST, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_MEDIUM_DIRECTION } from '../../nodes/random.wgsl.js';
import { rayDataStruct, rayQueueAtomicStruct, pixelQueueStruct } from './structs.js';
import { mediumStackEnterFunc, mediumStackExitFunc, stackMediumFunc, shadowMediumStackFunc, loadMediumFn, storeMediumFn, MEDIUM_STACK_EMPTY, MEDIUM_MAX_BOUNDARIES } from '../../nodes/medium.wgsl.js';
import { sampleHenyeyGreensteinFn, henyeyGreensteinPdfFn } from '../../nodes/sampling.wgsl.js';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { applyDispersionFunc, dispersionColorWeightFunc, DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH } from '../../nodes/material.wgsl.js';
import { isTerminatingScatterFunc, offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { LIGHT_EPSILON } from '../../nodes/lights.wgsl.js';
import { isAuxSurfaceFn } from '../../nodes/aux.wgsl.js';

// Pure material evaluation and ray generation: terminated slots pull a recycled pixel and emit a
// fresh camera ray; live slots evaluate the surface staged by LogicKernel, sample the bsdf, and
// enqueue the next bounce ray plus the NEE shadow ray toward the light LogicKernel selected.
export class MaterialKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			material: { value: null },

			seed: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			maxSamples: uniform( 0, 'uint' ),
			rayCount: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			maxBounces: uniform( 5, 'uint' ),
			maxFogBounces: uniform( 0, 'uint' ),

			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),

			// TODO: two elements so the placeholder compiles as an array. Remove once three declares every
			// storage buffer as an array, in r187
			rayDataStorage: storage( new StorageBufferAttribute( 2, 1 ), rayDataStruct ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueStruct ),

			globalId: globalId,
		};

		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );
		const sampleTrianglePointFn = contextProxyFn( 'bvhData.fns.sampleTrianglePoint' );
		const getSurfaceRecordFn = contextProxyFn( 'bvhData.fns.getSurfaceRecord' );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		const transformsNode = contextProxy( 'bvhData.storage.transforms' );
		const materialsNode = contextProxy( 'bvhData.storage.materials' );
		const mediumStackEnterFn = mediumStackEnterFunc( transformsNode, materialsNode );
		const mediumStackExitFn = mediumStackExitFunc( transformsNode );
		const stackMediumFn = stackMediumFunc( transformsNode, materialsNode );
		const shadowMediumStackFn = shadowMediumStackFunc( mediumStackEnterFn, mediumStackExitFn );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				seed: u32,
				targetDimensions: vec2u,
				maxSamples: u32,
				rayCount: u32,
				filterGlossy: f32,
				maxTransparentBounces: u32,
				maxBounces: u32,
				maxFogBounces: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let rayQueue = &${ params.rayQueue };
				let shadowRayQueue = &${ params.shadowRayQueue };
				let pixelQueue = &${ params.pixelQueue };

				let materials = &${ contextProxy( 'bvhData.storage.materials' ) };
				let transforms = &${ contextProxy( 'bvhData.storage.transforms' ) };

				// bound by "rayCount" rather than the pool length. The dispatch rounds up to the
				// workgroup size and those extra slots hold a zeroed pixel index
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				let input = ( *rayDataStorage )[ index ];
				if ( input.objectIndex < 0 ) {

					// the slot's path has terminated: recycle the pixel through the overflow queue and
					// generate a fresh camera ray
					var pixelIndex = input.pixelIndex;
					let elementCount = atomicLoad( &pixelQueue.elementCount );
					if ( elementCount > 0u ) {

						// TODO: If we've pulled off a pixel that's already finished we currently just
						// write a no-op ray, wasting a frame. It may be better to iterate over a few
						// points in the queue to see if we can find one we can use.
						let queueIndex = atomicAdd( &pixelQueue.current, 1u ) % elementCount;
						pixelIndex = atomicExchange( &pixelQueue.elements[ queueIndex ], pixelIndex );

					}

					let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );

					// skip the pixel if it has hit the sample limit
					let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
					let samples = ( ${ SAMPLE_COUNT_MASK }u & combinedField );
					let isComplete = maxSamples != 0u && samples >= maxSamples;

					if ( isComplete ) {

						rayDataStorage[ index ].pixelIndex = pixelIndex;
						rayDataStorage[ index ].rayIntersectionIndex = - 1;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					${ rngInit }( indexUV, seed + samples, 0 );

					let uv = vec2f( indexUV ) / vec2f( targetDimensions );
					let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
					var ray: ${ rayStruct };
					if ( ! ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ), &ray ) ) {

						// the camera declined the pixel, so leave the slot dormant for this round. With a
						// sample cap the pixel counts as finished, since it will never take a sample
						// TODO: same as above - this work is a bit wasteful and leaves slots empty for
						// a frame. Is it possible to quickly skip rays outside the mask or are finished?
						if ( maxSamples != 0u ) {

							textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ( combinedField & ~${ SAMPLE_COUNT_MASK }u ) | maxSamples ) );

						}

						rayDataStorage[ index ].pixelIndex = pixelIndex;
						rayDataStorage[ index ].rayIntersectionIndex = - 1;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					ray.direction = normalize( ray.direction );

					let rayIndex = atomicAdd( &rayQueue.length, 1u );
					rayQueue.elements[ rayIndex ].origin = ray.origin;
					rayQueue.elements[ rayIndex ].direction = ray.direction;
					rayQueue.elements[ rayIndex ].pixelIndex = pixelIndex;
					rayQueue.elements[ rayIndex ].currentBounce = 0u;
					rayQueue.elements[ rayIndex ].seed = seed + samples;
					rayQueue.elements[ rayIndex ].alphaDepth = 0u;
					rayQueue.elements[ rayIndex ].maxDist = ray.maxDist;

					rayDataStorage[ index ].origin = ray.origin;
					rayDataStorage[ index ].direction = ray.direction;
					rayDataStorage[ index ].pixelIndex = pixelIndex;
					rayDataStorage[ index ].seed = seed + samples;
					rayDataStorage[ index ].currentBounce = 0u;
					rayDataStorage[ index ].throughputColor = vec3f( 1.0 );
					rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
					rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
					rayDataStorage[ index ].scatterPdf = 1.0;
					rayDataStorage[ index ].minPdf = 1.0;
					rayDataStorage[ index ].isFullyTransmissive = 1u;
					rayDataStorage[ index ].emission = vec3f( 0.0 );
					rayDataStorage[ index ].lightPdf = 0.0;
					rayDataStorage[ index ].alphaDepth = 0u;
					rayDataStorage[ index ].maxDist = ray.maxDist;
					rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
					rayDataStorage[ index ].dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );
					rayDataStorage[ index ].auxAlbedo = 0u;
					rayDataStorage[ index ].auxNormal = 0u;
					rayDataStorage[ index ].subsurfaceBounces = 0u;
					rayDataStorage[ index ].fogBoundaries = 0u;
					rayDataStorage[ index ].fogBounces = 0u;
					rayDataStorage[ index ].walkPending = 0u;
					rayDataStorage[ index ].mediumScattered = 0u;
					rayDataStorage[ index ].mediumVertex = 0u;

					// CameraMediumKernel adds the volumes around the ray's origin, in scenes with any
					rayDataStorage[ index ].medium = ${ storeMediumFn }( ${ stackMediumFn }( vec4u( ${ MEDIUM_STACK_EMPTY }u ), ${ MEDIUM_STACK_EMPTY }u ) );
					rayDataStorage[ index ].lightPoint = vec4f( 0.0 );
					rayDataStorage[ index ].volumePointWeight = vec3f( 0.0 );
					rayDataStorage[ index ].volumeLightColor = vec3f( 0.0 );
					rayDataStorage[ index ].volumeShadowRayIntersectionIndex = - 1;

					// write the active params & dispatched flag
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_ACTIVE_FLAG }u | ${ SAMPLE_DISPATCHED_FLAG }u | samples ) );

				} else if ( input.walkPending == 0u ) {

					// evaluate the surface staged by LogicKernel. A path still walking a medium has none, and
					// its walk continues in MediumKernel
					let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
					${ rngInit }( indexUV, input.seed, input.currentBounce + input.alphaDepth + input.subsurfaceBounces + input.fogBoundaries );

					// the medium the path is inside of, which the bsdf sample below may enter or exit
					var medium = ${ loadMediumFn }( input.medium );
					let segmentInMedium = medium.inside;

					// the shadow ray of the light LogicKernel sampled from a point on the fog segment just walked
					if ( any( input.volumeLightColor > vec3f( 0.0 ) ) ) {

						let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
						shadowRayQueue.elements[ shadowIndex ].origin = input.volumeLightPosition;
						shadowRayQueue.elements[ shadowIndex ].direction = input.volumeLightDirection;
						shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
						shadowRayQueue.elements[ shadowIndex ].currentBounce = input.currentBounce;
						shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
						shadowRayQueue.elements[ shadowIndex ].alphaDepth = input.alphaDepth;
						shadowRayQueue.elements[ shadowIndex ].maxDist = input.volumeLightDist * ( 1.0 - ${ LIGHT_EPSILON } );
						shadowRayQueue.elements[ shadowIndex ].mediumStack = medium.stack;
						rayDataStorage[ index ].volumeShadowRayIntersectionIndex = i32( shadowIndex );

					} else {

						rayDataStorage[ index ].volumeShadowRayIntersectionIndex = - 1;

					}

					// A scatter event in fog, staged at "origin" by LogicKernel, is a path vertex like a surface,
					// counted as a bounce, that continues through the phase function
					if ( input.mediumVertex != 0u ) {

						let newBounce = input.currentBounce + 1u;
						let newDirection = ${ sampleHenyeyGreensteinFn }( input.direction, medium.anisotropy, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ) );
						let phasePdf = ${ henyeyGreensteinPdfFn }( dot( input.direction, newDirection ), medium.anisotropy );

						// russian roulette, as at a surface. The phase function's sample weight is one. Out of
						// fog bounces the path ends here, keeping the light sampled at the scatter
						var scatterColor = vec3f( phasePdf );
						var isTerminated = newBounce >= maxBounces || input.fogBounces >= maxFogBounces;
						if ( ! isTerminated && newBounce >= 3u ) {

							let rrThroughput = input.throughputColor;
							let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
							isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
							if ( ! isTerminated ) {

								scatterColor /= rrProb;

							}

						}

						rayDataStorage[ index ].scatterColor = scatterColor;
						rayDataStorage[ index ].scatterPdf = select( phasePdf, 0.0, isTerminated );
						rayDataStorage[ index ].isFullyTransmissive = 0u;
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].currentBounce = newBounce;
						rayDataStorage[ index ].fogBounces = input.fogBounces + 1u;
						rayDataStorage[ index ].mediumScattered = 0u;
						rayDataStorage[ index ].mediumVertex = 0u;

						// the next segment is walked through the fog by MediumKernel
						if ( ! isTerminated ) {

							rayDataStorage[ index ].walkPending = 1u;
							rayDataStorage[ index ].direction = newDirection;

						}

						// its light was sampled with its segment's
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					let objectInfo = transforms[ u32( input.objectIndex ) ];
					var materialInfo = ( *materials )[ objectInfo.materialIndex ];

					// a matte surface hit by the camera ray renders as a fully transparent
					let isMatte = materialInfo.matte != 0 && input.currentBounce == 0u;
					if ( isMatte ) {

						rayDataStorage[ index ].resultColor = vec4f( 0.0 );
						rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// apply per-object colors
					materialInfo.color *= objectInfo.color.rgb;
					materialInfo.opacity *= objectInfo.color.a;

					var vertexData = ${ sampleTrianglePointFn }( input.barycoord, input.indices );
					vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
					vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
					vertexData.position = objectInfo.matrixWorld * vertexData.position;

					let view = - input.direction;

					// blur glossy surfaces after low-probability bounces to suppress fireflies,
					// from the Cycles "filter glossy" approach in integrator/surface_shader.h
					let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

					var surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal, view, blurRoughness );

					// a medium that doesn't scatter only absorbs the light reaching the surface, so its emission
					// and NEE resolve against the attenuated throughput. One that does applied its transmittance
					// in MediumKernel
					var throughputColor = input.throughputColor;
					if ( ! segmentInMedium && any( medium.extinction > vec3f( 0.0 ) ) ) {

						throughputColor *= exp( - medium.extinction * input.dist );
						rayDataStorage[ index ].throughputColor = throughputColor;

					}

					// Stochastically pass through partially transparent surfaces by re-enqueueing
					// the ray at the hit point, advancing the alpha depth but not the bounce count. A
					// fog volume's boundary is always passed, entering or leaving its volume
					let isFogBoundary = materialInfo.fogVolume != 0;
					let passesThrough = isFogBoundary || ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity;
					if ( passesThrough ) {

						// out of transparent bounces, so stop rather than shading a surface that
						// should be invisible. A zeroed throughput terminates in LogicKernel. Fog
						// boundaries are counted apart instead, with a safety limit, as Cycles counts them
						let alphaDepth = input.alphaDepth + select( 1u, 0u, isFogBoundary );
						let fogBoundaries = input.fogBoundaries + select( 0u, 1u, isFogBoundary );
						if ( alphaDepth > maxTransparentBounces || fogBoundaries > ${ MEDIUM_MAX_BOUNDARIES }u ) {

							rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
							rayDataStorage[ index ].emission = vec3f( 0.0 );
							rayDataStorage[ index ].lightPdf = 0.0;
							rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
							return;

						}

						if ( isFogBoundary ) {

							var stack: vec4u;
							if ( input.side > 0.0 ) {

								stack = ${ mediumStackEnterFn }( medium.stack, u32( input.objectIndex ) );

							} else {

								stack = ${ mediumStackExitFn }( medium.stack, u32( input.objectIndex ) );

							}

							if ( any( stack != medium.stack ) ) {

								medium = ${ stackMediumFn }( stack, u32( input.objectIndex ) );
								rayDataStorage[ index ].medium = ${ storeMediumFn }( medium );

							}

						}

						let alphaOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.direction, input.normal );
						if ( medium.inside ) {

							// inside a medium, MediumKernel walks on past the surface
							rayDataStorage[ index ].walkPending = 1u;

						} else {

							let alphaIndex = atomicAdd( &rayQueue.length, 1u );
							rayQueue.elements[ alphaIndex ].origin = alphaOrigin;
							rayQueue.elements[ alphaIndex ].direction = input.direction;
							rayQueue.elements[ alphaIndex ].pixelIndex = input.pixelIndex;
							rayQueue.elements[ alphaIndex ].currentBounce = input.currentBounce;
							rayQueue.elements[ alphaIndex ].seed = input.seed;
							rayQueue.elements[ alphaIndex ].alphaDepth = alphaDepth;
							// the origin advanced to the hit point, so the remaining budget shrinks by the
							// distance already traced
							rayQueue.elements[ alphaIndex ].maxDist = max( input.maxDist - input.dist, 0.0 );
							rayDataStorage[ index ].rayIntersectionIndex = i32( alphaIndex );

						}

						// the surface is skipped, so no scatter or emission is staged for LogicKernel.
						// "pdf" is left alone so the previous scatter still weights the forward MIS,
						// and "bsdf" matches it so applying the scatter leaves the throughput as is.
						rayDataStorage[ index ].alphaDepth = alphaDepth;
						rayDataStorage[ index ].fogBoundaries = fogBoundaries;
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].scatterColor = vec3f( input.scatterPdf );
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].origin = alphaOrigin;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// apply the hero wavelength to dispersive surfaces, folding the spectral weight
					// into the throughput at the path's first dispersive interaction
					let isDispersive = materialInfo.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
					if ( isDispersive ) {

						let wavelength = abs( input.dispersionWavelength );
						${ applyDispersionFunc }( &surface, materialInfo.dispersion, wavelength );
						if ( input.dispersionWavelength < 0.0 ) {

							rayDataStorage[ index ].dispersionWavelength = wavelength;
							throughputColor *= ${ dispersionColorWeightFunc }( wavelength );
							rayDataStorage[ index ].throughputColor = throughputColor;

						}

					}

					// sample the next bounce direction and stage the scatter state for LogicKernel
					var scatterRec = ${ bsdfSampleFn }( view, surface );
					let newBounce = input.currentBounce + 1u;

					// The first surface the path scatters off fills the denoiser's auxiliary images. Until one is
					// found the last mirror or transmission hit stands in, for paths that reach the environment.
					// The albedo is tinted by the throughput of the surfaces looked past to reach it. The packed
					// albedo's alpha marks the surface found
					let auxFound = unpack4x8unorm( input.auxAlbedo ).a != 0.0;
					if ( ! auxFound ) {

						let isAuxSurface = ${ isAuxSurfaceFn }( surface, scatterRec );
						let auxAlbedo = saturate( throughputColor * surface.color );
						rayDataStorage[ index ].auxAlbedo = pack4x8unorm( vec4f( auxAlbedo, select( 0.0, 1.0, isAuxSurface ) ) );
						rayDataStorage[ index ].auxNormal = pack4x8snorm( vec4f( surface.normal, 0.0 ) );

					}

					// decide termination now so finished paths skip the bounce trace entirely - a
					// zeroed pdf reads as a terminating scatter in LogicKernel, which still resolves
					// the surface's emission and NEE before freeing the slot
					var isTerminated = newBounce >= maxBounces || all( scatterRec.color == vec3f( 0.0 ) ) || ${ isTerminatingScatterFunc }( scatterRec );

					// russian roulette early out:
					// Matches Cycles path_state_continuation_probability in integrator/path_state.h
					if ( ! isTerminated && newBounce >= 3u ) {

						let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
						let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
						isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
						if ( ! isTerminated ) {

							// fold the survival boost into the scatter color so LogicKernel's
							// throughput update applies it without a separate division
							scatterRec.color /= rrProb;

						}

					}

					// Write the ray storage content here since things like the emissive value is read
					// in the logic kernel on the subsequent frame.
					rayDataStorage[ index ].scatterColor = scatterRec.color;
					rayDataStorage[ index ].scatterPdf = select( scatterRec.pdf, 0.0, isTerminated );
					rayDataStorage[ index ].minPdf = min( input.minPdf, scatterRec.pdf );
					rayDataStorage[ index ].isFullyTransmissive = input.isFullyTransmissive & select( 0u, 1u, scatterRec.isTransmissive );
					rayDataStorage[ index ].emission = surface.emission;
					rayDataStorage[ index ].currentBounce = newBounce;
					rayDataStorage[ index ].mediumScattered = 0u;

					// As in "KHR_materials_scatter", a volume's surface bsdf is its boundary: light refracting in
					// through it enters the volume and out through it leaves, while light reflecting stays
					let surfaceStack = medium.stack;
					var mediumChanged = false;
					if ( scatterRec.isTransmissive && ! surface.thinWall ) {

						var stack: vec4u;
						if ( input.side > 0.0 ) {

							stack = ${ mediumStackEnterFn }( medium.stack, u32( input.objectIndex ) );

						} else {

							stack = ${ mediumStackExitFn }( medium.stack, u32( input.objectIndex ) );

						}

						if ( any( stack != medium.stack ) ) {

							medium = ${ stackMediumFn }( stack, u32( input.objectIndex ) );
							mediumChanged = true;

						}

					}

					// keep the medium the path left or entered
					if ( mediumChanged ) {

						rayDataStorage[ index ].medium = ${ storeMediumFn }( medium );

					}

					// the NEE shadow ray below still resolves the surface's direct light, so only
					// the bounce segment is skipped for finished paths. Inside a medium, MediumKernel
					// walks the segment instead of the trace kernel
					if ( ! isTerminated && medium.inside ) {

						rayDataStorage[ index ].walkPending = 1u;
						rayDataStorage[ index ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.normal );
						rayDataStorage[ index ].direction = scatterRec.direction;

					} else if ( ! isTerminated ) {

						let rayIndex = atomicAdd( &rayQueue.length, 1u );
						rayQueue.elements[ rayIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.normal );
						rayQueue.elements[ rayIndex ].direction = scatterRec.direction;
						rayQueue.elements[ rayIndex ].pixelIndex = input.pixelIndex;
						rayQueue.elements[ rayIndex ].currentBounce = newBounce;
						rayQueue.elements[ rayIndex ].seed = input.seed;
						rayQueue.elements[ rayIndex ].alphaDepth = input.alphaDepth;
						rayQueue.elements[ rayIndex ].maxDist = 0.0;
						rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );

						rayDataStorage[ index ].origin = rayQueue.elements[ rayIndex ].origin;
						rayDataStorage[ index ].direction = scatterRec.direction;

					}

					// evaluate the bsdf toward the light LogicKernel selected and enqueue the shadow ray.
					// the light pdf will be 0 if NEE is disabled.
					var lightPdf = input.lightPdf;
					if ( lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( view, input.lightDirection, surface );
						if ( evalRec.pdf > 0.0 ) {

							rayDataStorage[ index ].lightBsdf = evalRec.color;
							rayDataStorage[ index ].lightBsdfPdf = evalRec.pdf;

							let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
							shadowRayQueue.elements[ shadowIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.lightDirection, input.normal );
							shadowRayQueue.elements[ shadowIndex ].direction = input.lightDirection;
							shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
							shadowRayQueue.elements[ shadowIndex ].currentBounce = input.currentBounce;
							shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
							shadowRayQueue.elements[ shadowIndex ].alphaDepth = input.alphaDepth;
							shadowRayQueue.elements[ shadowIndex ].maxDist = input.lightDist * ( 1.0 - ${ LIGHT_EPSILON } );
							shadowRayQueue.elements[ shadowIndex ].mediumStack = ${ shadowMediumStackFn }(
								surfaceStack, u32( input.objectIndex ), input.side, surface.thinWall,
								input.direction, input.lightDirection, input.normal,
							);
							rayDataStorage[ index ].shadowRayIntersectionIndex = i32( shadowIndex );

						} else {

							lightPdf = 0.0;

						}

					}

					if ( lightPdf <= 0.0 ) {

						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

					}

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
