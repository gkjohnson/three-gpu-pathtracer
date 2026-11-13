import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { contextProxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand1, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_DISPERSION_WAVELENGTH } from '../../nodes/random.wgsl.js';
import { rayDataStruct, PIXEL_QUEUE_CURRENT, PIXEL_QUEUE_DROPPED, PIXEL_QUEUE_DROPPED_COUNT, PIXEL_QUEUE_ELEMENT_COUNT, PIXEL_QUEUE_HEADER } from './structs.js';
import { getPixelFinishedFn } from './CompactPixelQueueKernel.js';

// queue entries a slot tries for a pixel that still needs samples before it waits for the next round
const PIXEL_QUEUE_POP_ATTEMPTS = 4;
import { SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH } from '../../nodes/material.wgsl.js';

// Starts a new path in each slot whose path has ended: recycles the pixel through the overflow queue and writes
// a fresh camera ray. CameraMediumKernel then finds the ray's medium and queues it.
export class CameraRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			globalSeed: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			maxSamples: uniform( 0, 'uint' ),
			rayCount: uniform( 0, 'uint' ),

			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),

			globalId: globalId,
		};

		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );
		const isPixelFinishedFn = getPixelFinishedFn( params.sampleCountTarget );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				globalSeed: u32,
				targetDimensions: vec2u,
				maxSamples: u32,
				rayCount: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				// bound by "rayCount" rather than the pool length. The dispatch rounds up to the
				// workgroup size and those extra slots hold a zeroed pixel index
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// whole structs are read from the buffer, not the pointer alias, which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.hit.objectIndex >= 0 ) {

					return;

				}

				// Find a pixel for the slot that still needs samples, and a camera ray for it. With a queue the slot swaps
				// its pixel for the next one, and tries the entries after one it can't render: a dropped entry, a pixel
				// with all its samples, or one the camera declines. A pixel with all its samples leaves the queue as a
				// dropped entry, and the dropped entries are counted for the compaction pass. Without a queue the slot
				// keeps its pixel and tries it once
				var pixelIndex = input.pixelIndex;
				let elementCount = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ] );
				let attempts = select( 1u, ${ PIXEL_QUEUE_POP_ATTEMPTS }u, elementCount > 0u );

				// what the slot hands back to the queue for the next pixel it takes
				var returnedPixelIndex = pixelIndex;
				if ( pixelIndex != ${ PIXEL_QUEUE_DROPPED }u && ${ isPixelFinishedFn }( pixelIndex, maxSamples ) ) {

					returnedPixelIndex = ${ PIXEL_QUEUE_DROPPED }u;

				}

				var ray: ${ rayStruct };
				var samples = 0u;
				var hasRay = false;
				for ( var attempt = 0u; attempt < attempts; attempt ++ ) {

					if ( elementCount > 0u ) {

						let queueIndex = atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_CURRENT }u ], 1u ) % elementCount;
						pixelIndex = atomicExchange( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + queueIndex ], returnedPixelIndex );
						if ( returnedPixelIndex == ${ PIXEL_QUEUE_DROPPED }u ) {

							atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_DROPPED_COUNT }u ], 1u );

						}

						if ( pixelIndex == ${ PIXEL_QUEUE_DROPPED }u ) {

							atomicSub( &pixelQueue[ ${ PIXEL_QUEUE_DROPPED_COUNT }u ], 1u );
							returnedPixelIndex = ${ PIXEL_QUEUE_DROPPED }u;
							continue;

						}

					}

					// a slot without a queue and without a pixel waits
					if ( pixelIndex == ${ PIXEL_QUEUE_DROPPED }u ) {

						break;

					}

					// a pixel with all its samples is dropped
					let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );
					let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
					samples = ${ SAMPLE_COUNT_MASK }u & combinedField;
					if ( maxSamples != 0u && samples >= maxSamples ) {

						returnedPixelIndex = ${ PIXEL_QUEUE_DROPPED }u;
						continue;

					}

					${ rngInit }( globalSeed, indexUV, samples, 0 );

					let uv = vec2f( indexUV ) / vec2f( targetDimensions );
					let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
					if ( ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ), &ray ) ) {

						hasRay = true;
						break;

					}

					// The camera declined the pixel. With a sample cap it counts as finished, since it will never take
					// a sample, and is dropped. Otherwise it goes back to the queue
					returnedPixelIndex = pixelIndex;
					if ( maxSamples != 0u ) {

						textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ( combinedField & ~${ SAMPLE_COUNT_MASK }u ) | maxSamples ) );
						returnedPixelIndex = ${ PIXEL_QUEUE_DROPPED }u;

					}

				}

				// every pixel tried can't be rendered, so the slot waits for the next round holding what it would
				// hand back
				if ( ! hasRay ) {

					rayDataStorage[ index ].pixelIndex = returnedPixelIndex;
					rayDataStorage[ index ].rayIntersectionIndex = - 1;
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
					return;

				}

				let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );

				ray.direction = normalize( ray.direction );

				rayDataStorage[ index ].origin = ray.origin;
				rayDataStorage[ index ].direction = ray.direction;
				rayDataStorage[ index ].pixelIndex = pixelIndex;
				rayDataStorage[ index ].sampleIndex = samples;
				rayDataStorage[ index ].hit.bounce = 0u;
				rayDataStorage[ index ].throughputColor = vec3f( 1.0 );
				rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
				rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
				rayDataStorage[ index ].scatterPdf = 1.0;
				rayDataStorage[ index ].minPdf = 1.0;
				rayDataStorage[ index ].isFullyTransmissive = 1u;
				rayDataStorage[ index ].emission = vec3f( 0.0 );
				rayDataStorage[ index ].lightPdf = 0.0;
				rayDataStorage[ index ].alphaDepth = 0u;
				rayDataStorage[ index ].rayStart = 0.0;
				rayDataStorage[ index ].maxDist = ray.maxDist;
				rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
				rayDataStorage[ index ].dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );
				rayDataStorage[ index ].auxAlbedo = 0u;
				rayDataStorage[ index ].auxNormal = 0u;
				rayDataStorage[ index ].subsurfaceBounces = 0u;
				rayDataStorage[ index ].fogBounces = 0u;
				rayDataStorage[ index ].walkPending = 0u;
				rayDataStorage[ index ].mediumScattered = 0u;
				rayDataStorage[ index ].fogScatter = 0u;
				rayDataStorage[ index ].cameraHitLight = 0u;

				// marks the slot as spawned this round. CameraMediumKernel replaces it with the ray's queue index
				rayDataStorage[ index ].rayIntersectionIndex = 0;

				// write the active params & dispatched flag
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_ACTIVE_FLAG }u | ${ SAMPLE_DISPATCHED_FLAG }u | samples ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
