import { StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, wgslFn, globalId, uniform } from 'three/tsl';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK } from './TallySampleCountsKernel.js';

// Kernel for copying count + active flag to an output target for debug visualizations
export class SampleDebugKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			displaySamples: uniform( true ),
			inputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				globalId: vec3u,
				inputTarget: texture_storage_2d<r32uint, read>,
				outputTarget: texture_storage_2d<rgba8unorm, read_write>,
				displaySamples: u32
			) -> void {

				let combined = textureLoad( inputTarget, globalId.xy ).r;
				let isActive = ( ${ SAMPLE_ACTIVE_FLAG }u & combined ) != 0u;
				let samples = combined & ${ SAMPLE_COUNT_MASK }u;

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
