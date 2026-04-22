import { IndirectStorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			processed: uniform( 0 ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( processed: u32 ) -> void {

				let queueSizes = &${ params.queueSizes };
			    var queueSize = queueSizes[ 1 ] - queueSizes[ 0 ];
				if ( processed > queueSize ) {

					queueSizes[ 0 ] = queueSizes[ 1 ];

				} else {

					queueSizes[ 0 ] = queueSizes[ 0 ] + processed;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
