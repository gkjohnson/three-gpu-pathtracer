import { IndirectStorageBufferAttribute } from 'three/webgpu';
import { wgslFn, uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { queuedRayStruct } from './structs.js';

export class UpdateRayQueueParamsKernel extends ComputeKernel {

	constructor() {

		const params = {
			processed: uniform( 0 ),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),
		};

		const kernel = wgslFn( /* wgsl */`
			fn compute(
				processed: u32,
				rayQueueSize: ptr<storage, array<u32>, read_write>,
			) -> void {

			    var queueSize = rayQueueSize[ 1 ] - rayQueueSize[ 0 ];
				if ( processed > queueSize ) {

					rayQueueSize[ 0 ] = rayQueueSize[ 1 ];

				} else {

					rayQueueSize[ 0 ] = rayQueueSize[ 0 ] + processed;

				}

			}
		`, [ queuedRayStruct ] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
