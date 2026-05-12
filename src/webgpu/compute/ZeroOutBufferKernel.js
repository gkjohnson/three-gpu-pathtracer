import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';

export class ZeroOutBufferKernel extends ComputeKernel {

	constructor( options = {} ) {

		const {
			type = 'u32',
		} = options;

		const params = {
			globalId: globalId,
			outputTarget: storage( new StorageBufferAttribute( 1, 1 ), type ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				${ params.outputTarget }[ globalId.x ] = 0;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( {
			target: params.outputTarget,
		} );

	}

}
