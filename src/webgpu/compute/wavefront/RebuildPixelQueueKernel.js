import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK } from '../../constants.js';
import { pixelQueueInfoStruct } from './structs.js';

// Rebuilds the pixel queue, putting the pixels with fewer samples at the front
export class RebuildPixelQueueKernel extends ComputeKernel {

	constructor() {

		const params = {
			maxSamples: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadOnly(),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			pixelQueueInfo: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueInfoStruct ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( maxSamples: u32, targetDimensions: vec2u, globalId: vec3u ) -> void {

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

				var queueIndex: u32;
				if ( samples <= atomicLoad( &${ params.pixelQueueInfo }[ 0 ].sampleCountMidpoint ) ) {

					queueIndex = atomicAdd( &${ params.pixelQueueInfo }[ 0 ].frontCount, 1u );

				} else {

					queueIndex = arrayLength( &${ params.pixelQueue } ) - 1u - atomicAdd( &${ params.pixelQueueInfo }[ 0 ].backCount, 1u );

				}

				${ params.pixelQueue }[ queueIndex ] = ( uv.x << 16 ) | uv.y;

				// checked first so most threads skip the atomics
				if ( samples < atomicLoad( &${ params.pixelQueueInfo }[ 0 ].minSamples ) ) {

					atomicMin( &${ params.pixelQueueInfo }[ 0 ].minSamples, samples );

				}

				if ( samples > atomicLoad( &${ params.pixelQueueInfo }[ 0 ].maxSamples ) ) {

					atomicMax( &${ params.pixelQueueInfo }[ 0 ].maxSamples, samples );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
