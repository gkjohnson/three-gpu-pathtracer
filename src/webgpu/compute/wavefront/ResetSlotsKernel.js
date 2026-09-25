import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, pixelQueueStruct, PIXEL_INDEX_NONE } from './structs.js';

// what happens to the slot's pixel: kept as is, returned to the queue, or taken from the queue
export const RESET_SLOTS_KEEP = 0;
export const RESET_SLOTS_RETURN = 1;
export const RESET_SLOTS_TAKE = 2;

// Puts a range of path slots into the idle state, as MaterialKernel expects for slots it may spawn
// into. Slots retired by a pool shrink return their pixel to the queue tail; slots added by a grow
// take one from it, so every pixel stays either in a slot or in the queue and the queue never
// holds an empty entry. Runs between frames, so nothing else touches the queue meanwhile.
export class ResetSlotsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueStruct ),
			start: uniform( 0, 'uint' ),
			end: uniform( 0, 'uint' ),
			mode: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( start: u32, end: u32, mode: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				let index = start + globalId.x;
				if ( index >= end ) {

					return;

				}

				var pixelIndex = rayDataStorage[ index ].pixelIndex;
				if ( mode == ${ RESET_SLOTS_RETURN }u ) {

					if ( pixelIndex != ${ PIXEL_INDEX_NONE }u ) {

						let queueIndex = atomicAdd( &pixelQueue.elementCount, 1u );
						atomicStore( &pixelQueue.elements[ queueIndex ], pixelIndex );

					}

					pixelIndex = ${ PIXEL_INDEX_NONE }u;

				} else if ( mode == ${ RESET_SLOTS_TAKE }u ) {

					// pop from the tail. The pool never exceeds the pixel count, so the queue holds
					// enough for every new slot, but an empty queue is still guarded against
					let previousCount = atomicSub( &pixelQueue.elementCount, 1u );
					if ( previousCount == 0u ) {

						atomicAdd( &pixelQueue.elementCount, 1u );
						pixelIndex = ${ PIXEL_INDEX_NONE }u;

					} else {

						pixelIndex = atomicLoad( &pixelQueue.elements[ previousCount - 1u ] );

					}

				}

				rayDataStorage[ index ].pixelIndex = pixelIndex;
				rayDataStorage[ index ].resultColor = vec4f( 0.0 );
				rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
				rayDataStorage[ index ].objectIndex = - 1;
				rayDataStorage[ index ].alphaDepth = 0u;
				rayDataStorage[ index ].rayIntersectionIndex = - 1;
				rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
