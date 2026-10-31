import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { RAY_QUEUE_LENGTH } from './structs.js';

// Converts a queue's atomic length counter into indirect dispatch arguments so the trace kernels can
// be dispatched with exactly as many threads as there are queued rays.
export class QueueLengthToDispatchKernel extends ComputeKernel {

	constructor( counterIndex = RAY_QUEUE_LENGTH, workgroupSize = 64 ) {

		const params = {
			queueCounters: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				let queueCounters = &${ params.queueCounters };
				let outputDispatch = &${ params.outputDispatch };

				let queueLength = atomicLoad( &queueCounters[ ${ counterIndex }u ] );
				outputDispatch[ 0 ] = ( queueLength + ${ workgroupSize - 1 }u ) / ${ workgroupSize }u;
				outputDispatch[ 1 ] = 1u;
				outputDispatch[ 2 ] = 1u;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
