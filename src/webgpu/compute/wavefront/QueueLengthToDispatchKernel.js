import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage } from 'three/tsl';
import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';

export class QueueLengthToDispatchKernel extends ComputeKernel {

	constructor( queueStruct ) {

		const params = {
			queue: storage( new StorageBufferAttribute( 1, 1 ), queueStruct ),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				let queueLength = ${ params.queue }.end - ${ params.queue }.start;

				// assumes the consuming kernel runs 64 threads per workgroup
				${ params.outputDispatch }[ 0 ] = u32( ceil( f32( queueLength ) / 64.0 ) );
				${ params.outputDispatch }[ 1 ] = 1u;
				${ params.outputDispatch }[ 2 ] = 1u;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
