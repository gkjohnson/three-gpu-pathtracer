import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, pixelQueueStruct } from './structs.js';

// Moves pixels between a range of path slots and the queue when the pool is resized. Slots added
// by a grow take a pixel from the queue tail and start idle, as MaterialKernel expects. Slots
// dropped by a shrink push their pixel onto the tail before the pool is discarded. Runs between
// frames, so nothing else touches the queue meanwhile.
export class ResetSlotsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueStruct ),
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

				// slots being removed hand their pixel back before the pool is discarded
				if ( addingSlots == 0u ) {

					let queueIndex = atomicAdd( &pixelQueue.elementCount, 1u );
					atomicStore( &pixelQueue.elements[ queueIndex ], rayDataStorage[ index ].pixelIndex );
					return;

				}

				// the pool never exceeds the pixel count, so the queue holds enough for every new slot
				let previousCount = atomicSub( &pixelQueue.elementCount, 1u );
				rayDataStorage[ index ].pixelIndex = atomicLoad( &pixelQueue.elements[ previousCount - 1u ] );
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
