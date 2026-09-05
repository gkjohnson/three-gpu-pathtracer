import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayQueueAtomicStruct } from './structs.js';

// Converts a queue's atomic length counter into indirect dispatch arguments so the trace kernels can
// be dispatched with exactly as many threads as there are queued rays.
export class QueueLengthToDispatchKernel extends ComputeKernel {

	constructor( queueStruct = rayQueueAtomicStruct, workgroupSize = 64 ) {

		const params = {
			queue: storage( new StorageBufferAttribute( 1, 1 ), queueStruct ),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				let queue = &${ params.queue };
				let outputDispatch = &${ params.outputDispatch };

				let queueLength = atomicLoad( &queue.length );
				outputDispatch[ 0 ] = ( queueLength + ${ workgroupSize - 1 }u ) / ${ workgroupSize }u;
				outputDispatch[ 1 ] = 1u;
				outputDispatch[ 2 ] = 1u;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
