import { IndirectStorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			processed: uniform( 0 ),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( processed: u32 ) -> void {

				let rayQueueSize = &${ params.rayQueueSize };
			    var queueSize = rayQueueSize[ 1 ] - rayQueueSize[ 0 ];
				if ( processed > queueSize ) {

					rayQueueSize[ 0 ] = rayQueueSize[ 1 ];

				} else {

					rayQueueSize[ 0 ] = rayQueueSize[ 0 ] + processed;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
