import { StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, wgslFn, globalId, uniform } from 'three/tsl';

export class SampleDebugKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			displaySamples: uniform( true ),
			inputTarget: textureStore( new StorageTexture( 1, 1 ), 'u32' ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ), 'vec4f' ).toReadWrite(),
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				globalId: vec3u,
				inputTarget: texture_storage_2d<r32uint, read>,
				outputTarget: texture_storage_2d<rgba8unorm, read_write>,
				displaySamples: u32
			) -> void {

				let ACTIVE_FLAG = 0xFF000000u;
				let combined = textureLoad( inputTarget, globalId.xy ).r;
				let isActive = ( ACTIVE_FLAG & combined ) != 0u;
				let samples = combined & ( ~ ACTIVE_FLAG );

				if ( displaySamples != 0 ) {

					textureStore( outputTarget, globalId.xy, vec4f( f32( samples ) * 0.01, 0, 0, 1.0 ) );

				} else {

					let v = f32( isActive );
					textureStore( outputTarget, globalId.xy, vec4f( v, v, v, 1.0 ) );

				}

			}
		` )( params );

		super( fn );

		this.defineUniformAccessors( params );

	}

}
