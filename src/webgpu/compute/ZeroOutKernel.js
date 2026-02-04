import { StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, wgslFn, globalId } from 'three/tsl';

export class ZeroOutKernel extends ComputeKernel {

	get target() {

		return this._target.value;

	}

	set target( v ) {

		this._target.value = v;

	}

	constructor( { textureType = 'rgba32float' } ) {

		const params = {
			globalId: globalId,
			outputTarget: textureStore( new StorageTexture( 1, 1 ), textureType ).toReadWrite(),
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				globalId: vec3u,
				outputTarget: texture_storage_2d<${ textureType }, read_write>,
			) -> void {

				textureStore( outputTarget, globalId.xy, vec4( 0, 0, 0, 1 ) );

			}
		` )( params );

		super( fn );

		this._target = params.outputTarget;

	}

}
