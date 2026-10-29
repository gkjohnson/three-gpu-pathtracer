import { StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

export class ZeroOutKernel extends ComputeKernel {

	// "target" sets the format the kernel is compiled for. An array texture is cleared a layer per z
	constructor( target = new StorageTexture( 1, 1 ) ) {

		const params = {
			globalId: globalId,
			outputTarget: textureStore( target ).toWriteOnly(),
		};

		const coord = target.isArrayTexture ? 'globalId.xy, globalId.z' : 'globalId.xy';
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
