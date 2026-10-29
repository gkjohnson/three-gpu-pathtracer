import { StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

export class ZeroOutKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
		};

		// resolved when the shader is built, so an array texture target is cleared a layer per z
		const coord = () => params.outputTarget.value.isArrayTexture ? 'globalId.xy, globalId.z' : 'globalId.xy';
		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				textureStore( ${ params.outputTarget }, ${ coord }, vec4( 0, 0, 0, 1 ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( {
			target: params.outputTarget,
		} );

	}

}
