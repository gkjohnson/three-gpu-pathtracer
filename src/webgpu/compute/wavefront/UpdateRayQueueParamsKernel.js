import { IndirectStorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { queueSizesStructFree } from './structs.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			processed: uniform( 0 ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), queueSizesStructFree ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( processed: u32 ) -> void {

				let queueSizes = &${ params.queueSizes };
			  var queueSize = queueSizes.rayQueueEnd - queueSizes.rayQueueStart;
				if ( processed > queueSize ) {

					queueSizes.rayQueueStart = queueSizes.rayQueueEnd;

				} else {

					queueSizes.rayQueueStart = queueSizes.rayQueueStart + processed;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
