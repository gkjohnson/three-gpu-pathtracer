import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayQueueStruct } from './structs.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			processed: uniform( 0 ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( processed: u32 ) -> void {

				let rayQueue = &${ params.rayQueue };
			    var queueSize = rayQueue.end - rayQueue.start;
				if ( processed > queueSize ) {

					rayQueue.start = rayQueue.end;

				} else {

					rayQueue.start = rayQueue.start + processed;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
