import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { storage, wgslFn, globalId } from 'three/tsl';

export class ZeroOutBufferKernel extends ComputeKernel {

	constructor( options = {} ) {

		const {
			type = 'u32',
		} = options;

		const params = {
			globalId: globalId,
			outputTarget: storage( new StorageBufferAttribute(), type ),
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				globalId: vec3u,
				outputTarget: ptr<storage, array<u32>, read_write>,
			) -> void {

				outputTarget[ globalId.x ] = 0;

			}
		` )( params );

		super( fn );

		this.defineUniformAccessors( {
			target: params.outputTarget,
		} );

	}

}
