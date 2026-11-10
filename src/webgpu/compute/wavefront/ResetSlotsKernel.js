import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, PIXEL_QUEUE_ELEMENT_COUNT, PIXEL_QUEUE_HEADER, NO_PIXEL } from './structs.js';

// Moves pixels between a range of path slots and the queue when the pool is resized. Slots added
// by a grow take a pixel from the queue tail and start idle, as MaterialKernel expects. Slots
// dropped by a shrink push their pixel onto the tail before the pool is discarded. Runs between
// frames, so nothing else touches the queue meanwhile.
export class ResetSlotsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			start: uniform( 0, 'uint' ),
			end: uniform( 0, 'uint' ),
			addingSlots: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( start: u32, end: u32, addingSlots: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				let index = start + globalId.x;
				if ( index >= end ) {

					return;

				}

				if ( addingSlots == 0u ) {

					// slots being removed hand their pixel back before the pool is discarded
					let pixelIndex = rayDataStorage[ index ].pixelIndex;
					if ( pixelIndex != ${ NO_PIXEL }u ) {

						let queueIndex = atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 1u );
						atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + queueIndex ], pixelIndex );

					}

				} else {

					// the camera may accept fewer pixels than the pool holds, so new slots past the queue's end
					// start without one. A decrement that finds the queue empty is undone
					var pixelIndex = ${ NO_PIXEL }u;
					let previousCount = atomicSub( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 1u );
					if ( previousCount > 0u && previousCount <= arrayLength( pixelQueue ) - ${ PIXEL_QUEUE_HEADER }u ) {

						pixelIndex = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + previousCount - 1u ] );

					} else {

						atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 1u );

					}

					rayDataStorage[ index ].pixelIndex = pixelIndex;
					rayDataStorage[ index ].resultColor = vec4f( 0.0 );
					rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
					rayDataStorage[ index ].hit.objectIndex = - 1;
					rayDataStorage[ index ].alphaDepth = 0u;
					rayDataStorage[ index ].rayIntersectionIndex = - 1;
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
