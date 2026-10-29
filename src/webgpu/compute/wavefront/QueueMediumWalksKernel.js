import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, mediumQueueStruct } from './structs.js';

// Gathers the live path slots walking a medium into the queue MediumKernel is dispatched over. Kept out
// of MaterialKernel, which is at its storage buffer limit.
export class QueueMediumWalksKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayCount: uniform( 0, 'uint' ),

			// TODO: two elements so the placeholder compiles as an array. Remove once three declares every
			// storage buffer as an array, in r187
			rayDataStorage: storage( new StorageBufferAttribute( 2, 1 ), rayDataStruct ).toReadOnly(),
			mediumQueue: storage( new StorageBufferAttribute( 1, 1 ), mediumQueueStruct ),

			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`

			fn compute( rayCount: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let mediumQueue = &${ params.mediumQueue };

				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				if ( rayDataStorage[ index ].walkPending != 0u && rayDataStorage[ index ].objectIndex >= 0 ) {

					let queueIndex = atomicAdd( &mediumQueue.length, 1u );
					mediumQueue.elements[ queueIndex ] = index;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
