import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayQueueStruct } from './structs.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				let rayQueue = &${ params.rayQueue };

				// the intersection kernel is dispatched indirectly over the exact queue length, so
				// every queued ray has been consumed
				rayQueue.start = rayQueue.end;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
