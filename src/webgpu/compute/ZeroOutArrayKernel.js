import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { createAuxTarget } from './targets.js';

// Zeroes every layer of the auxiliary image array, dispatched over width, height, and layers
export class ZeroOutArrayKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			outputTarget: textureStore( createAuxTarget() ).toWriteOnly(),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				textureStore( ${ params.outputTarget }, globalId.xy, globalId.z, vec4u( 0u ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( {
			target: params.outputTarget,
		} );

	}

}
