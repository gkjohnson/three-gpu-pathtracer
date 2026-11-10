import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { contextProxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { rayDataStruct, PIXEL_QUEUE_CURRENT, PIXEL_QUEUE_ELEMENT_COUNT, PIXEL_QUEUE_ACCEPTED, PIXEL_QUEUE_HEADER, NO_PIXEL } from './structs.js';

// Runs once per reset, in two passes over the pixels. The first clears the path slots in use, leaving them
// without a pixel. The second asks the camera for a ray through the center of each pixel and hands the
// pixels it accepts to the slots, in the order they are accepted, parking the overflow in the pixel queue.
// Pixels the camera declines, like the empty texels of a light map atlas, never take a slot or a place in
// the queue. Slots are initialized so LogicKernel skips them and MaterialKernel immediately generates fresh
// camera rays. Later budget changes are handled by resizing the pool in the render loop, with
// ResetSlotsKernel returning retired slots' pixels.
export class PopulatePixelIndicesKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			targetDimensions: uniform( new Vector2() ),
			frameBudget: uniform( 0, 'uint' ),
			assignPixels: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );

		const fn = wgslTagFn/* wgsl */`
			fn compute( targetDimensions: vec2u, frameBudget: u32, assignPixels: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				if ( globalId.x >= targetDimensions.x || globalId.y >= targetDimensions.y ) {

					return;

				}

				let rayCount = min( frameBudget, arrayLength( rayDataStorage ) );
				let pixelIndex = globalId.x + globalId.y * targetDimensions.x;
				if ( assignPixels == 0u ) {

					if ( pixelIndex == 0u ) {

						atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_CURRENT }u ], 0u );
						atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 0u );
						atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_ACCEPTED }u ], 0u );

					}

					if ( pixelIndex < rayCount ) {

						rayDataStorage[ pixelIndex ].pixelIndex = ${ NO_PIXEL }u;
						rayDataStorage[ pixelIndex ].resultColor = vec4f( 0.0 );
						rayDataStorage[ pixelIndex ].throughputColor = vec3f( 0.0 );
						rayDataStorage[ pixelIndex ].hit.objectIndex = - 1;
						rayDataStorage[ pixelIndex ].alphaDepth = 0u;
						rayDataStorage[ pixelIndex ].rayIntersectionIndex = - 1;
						rayDataStorage[ pixelIndex ].shadowRayIntersectionIndex = - 1;

					}

					return;

				}

				// cameras that read the scene decide per pixel, so the decision through the center holds for
				// every sample of it
				${ rngInit }( 0u, globalId.xy, 0u, 0u );
				var ray: ${ rayStruct };
				let center = ( vec2f( globalId.xy ) + 0.5 ) / vec2f( targetDimensions );
				if ( ! ${ getCameraRayFn }( center, vec2f( targetDimensions ), &ray ) ) {

					return;

				}

				let pixelHash = ( globalId.x << 16 ) | globalId.y;
				let accepted = atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_ACCEPTED }u ], 1u );
				if ( accepted < rayCount ) {

					rayDataStorage[ accepted ].pixelIndex = pixelHash;

				} else {

					let queueIndex = atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 1u );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + queueIndex ], pixelHash );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
