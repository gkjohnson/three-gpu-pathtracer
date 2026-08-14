import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayQueueStruct } from './structs.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			maxCount: uniform( 0xffffffff ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( maxCount: u32 ) -> void {

				let rayQueue = &${ params.rayQueue };

				// the intersection kernel is dispatched indirectly over the exact queue length, so
				// every queued ray has been consumed
				let queueSize = rayQueue.end - rayQueue.start;
				let dispatched = u32( ceil( f32( min( queueSize, maxCount ) ) / 64.0 ) ) * 64u;
				rayQueue.start = rayQueue.start + min( queueSize, dispatched );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
