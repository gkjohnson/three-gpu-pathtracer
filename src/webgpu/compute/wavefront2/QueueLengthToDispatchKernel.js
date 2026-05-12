import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';
import { ComputeKernel } from '../ComputeKernel';
import { storage } from 'three/tsl';
import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';

export class QueueLengthToDispatchKernel extends ComputeKernel {

	constructor( queueStruct ) {

		const params = {
			queue: storage( new StorageBufferAttribute(), queueStruct ),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				let queueLength = atomicLoad( &${ params.queue }.length );
				${ params.outputDispatch }[ 0 ] = ( queueLength + 63u ) / 64u;
				${ params.outputDispatch }[ 1 ] = 1u;
				${ params.outputDispatch }[ 2 ] = 1u;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
