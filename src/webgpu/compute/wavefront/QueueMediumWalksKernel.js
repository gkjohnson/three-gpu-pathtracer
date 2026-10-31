import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, MEDIUM_QUEUE_LENGTH, MEDIUM_QUEUE_HEADER } from './structs.js';

// Gathers the path slots walking a medium for MediumKernel's dispatch. Separate from MaterialKernel, which
// is at its storage buffer limit.
export class QueueMediumWalksKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayCount: uniform( 0, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ).toReadOnly(),
			mediumQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),

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

					let queueIndex = atomicAdd( &mediumQueue[ ${ MEDIUM_QUEUE_LENGTH }u ], 1u );
					atomicStore( &mediumQueue[ ${ MEDIUM_QUEUE_HEADER }u + queueIndex ], index );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
