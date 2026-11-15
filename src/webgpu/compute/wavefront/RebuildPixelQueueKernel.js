import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK } from '../../constants.js';
import {
	PIXEL_QUEUE_FRONT_COUNT, PIXEL_QUEUE_BACK_COUNT, PIXEL_QUEUE_MIN_SAMPLES, PIXEL_QUEUE_MAX_SAMPLES,
	PIXEL_QUEUE_SAMPLE_SPLIT, PIXEL_QUEUE_HEADER,
} from './structs.js';

// Rebuilds the pixel queue from the sample counts, with every pixel that still needs samples and isn't being
// traced. Pixels in the lower half of the sample count range go to the front so they are sampled first, which
// keeps the counts even when the pixels still being traced at a rebuild skip a pass. Records the range of the
// queued pixels' sample counts for the next rebuild.
export class RebuildPixelQueueKernel extends ComputeKernel {

	constructor() {

		const params = {
			maxSamples: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadOnly(),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( maxSamples: u32, targetDimensions: vec2u, globalId: vec3u ) -> void {

				let pixelQueue = &${ params.pixelQueue };

				let uv = globalId.xy;
				if ( uv.x >= targetDimensions.x || uv.y >= targetDimensions.y ) {

					return;

				}

				let combinedField = textureLoad( ${ params.sampleCountTarget }, uv ).r;
				let samples = combinedField & ${ SAMPLE_COUNT_MASK }u;
				let isActive = ( combinedField & ${ SAMPLE_ACTIVE_FLAG }u ) != 0u;
				let isFinished = maxSamples != 0u && samples >= maxSamples;
				if ( isActive || isFinished ) {

					return;

				}

				// the split is "min + max", so this compares against the middle of the range
				var queueIndex: u32;
				if ( 2u * samples <= atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_SAMPLE_SPLIT }u ] ) ) {

					queueIndex = atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_FRONT_COUNT }u ], 1u );

				} else {

					queueIndex = targetDimensions.x * targetDimensions.y - 1u - atomicAdd( &pixelQueue[ ${ PIXEL_QUEUE_BACK_COUNT }u ], 1u );

				}

				atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + queueIndex ], ( uv.x << 16 ) | uv.y );

				// checked first so most threads skip the contended atomics
				if ( samples < atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_MIN_SAMPLES }u ] ) ) {

					atomicMin( &pixelQueue[ ${ PIXEL_QUEUE_MIN_SAMPLES }u ], samples );

				}

				if ( samples > atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_MAX_SAMPLES }u ] ) ) {

					atomicMax( &pixelQueue[ ${ PIXEL_QUEUE_MAX_SAMPLES }u ], samples );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
