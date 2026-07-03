import { StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from '../lib/three-mesh-bvh/index.js';

export class ZeroOutKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				textureStore( ${ params.outputTarget }, globalId.xy, vec4( 0, 0, 0, 1 ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( {
			target: params.outputTarget,
		} );

	}

}
