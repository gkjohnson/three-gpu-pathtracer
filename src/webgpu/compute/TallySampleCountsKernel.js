import { StorageBufferAttribute, StorageTexture, StructTypeNode } from 'three/webgpu';
import { storage, textureStore, globalId, uniform } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { SAMPLE_CONVERGED_FLAG, SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../constants.js';

// field order of the sample counter buffer, matching the struct below
export const SAMPLE_COUNTER_MIN = 0;
export const SAMPLE_COUNTER_MAX = 1;
export const SAMPLE_COUNTER_TOTAL_LO = 2;
export const SAMPLE_COUNTER_TOTAL_HI = 3;
export const SAMPLE_COUNTER_PIXEL_COUNT = 4;
export const SAMPLE_COUNTER_FINISHED_COUNT = 5;
export const SAMPLE_COUNTER_LENGTH = 6;

export const U32_RANGE = 4294967296;

// Reduction target for the sample counts. The total outgrows 32 bits, so it is split across
// "totalLo" and "totalHi" and reassembled on read.
export const sampleCountersStruct = new StructTypeNode( {
	minSamples: { type: 'uint', atomic: true },
	maxSamples: { type: 'uint', atomic: true },
	totalLo: { type: 'uint', atomic: true },
	totalHi: { type: 'uint', atomic: true },
	pixelCount: { type: 'uint', atomic: true },
	finishedCount: { type: 'uint', atomic: true },
}, 'SampleCounters' );

// Clears the counters ahead of the tally. "minSamples" starts at the u32 max so the first
// "atomicMin" replaces it.
export class PrimeSampleCountersKernel extends ComputeKernel {

	constructor() {

		const params = {
			counters: storage( new StorageBufferAttribute( 1, 1 ), sampleCountersStruct ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				atomicStore( &${ params.counters }[ 0 ].minSamples, 0xFFFFFFFFu );
				atomicStore( &${ params.counters }[ 0 ].maxSamples, 0u );
				atomicStore( &${ params.counters }[ 0 ].totalLo, 0u );
				atomicStore( &${ params.counters }[ 0 ].totalHi, 0u );
				atomicStore( &${ params.counters }[ 0 ].pixelCount, 0u );
				atomicStore( &${ params.counters }[ 0 ].finishedCount, 0u );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}

// Reduces the sample count target to a min, max, total and finished pixel count so the CPU reads back a few
// values instead of the whole texture.
export class TallySampleCountsKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			maxSamples: uniform( 0, 'uint' ),
			counters: storage( new StorageBufferAttribute( 1, 1 ), sampleCountersStruct ),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u, maxSamples: u32 ) -> void {

				let targetDimensions = textureDimensions( ${ params.sampleCountTarget } );
				if ( globalId.x >= targetDimensions.x || globalId.y >= targetDimensions.y ) {

					return;

				}

				// pixels without a camera ray aren't part of the image, so skip rather than count zero
				let combinedField = textureLoad( ${ params.sampleCountTarget }, globalId.xy ).r;
				if ( ( combinedField & ${ SAMPLE_DISPATCHED_FLAG }u ) == 0u ) {

					return;

				}

				let samples = combinedField & ${ SAMPLE_COUNT_MASK }u;

				atomicMin( &${ params.counters }[ 0 ].minSamples, samples );
				atomicMax( &${ params.counters }[ 0 ].maxSamples, samples );
				atomicAdd( &${ params.counters }[ 0 ].pixelCount, 1u );

				// a pixel adaptive sampling stopped is done too, without the sample cap
				let isConverged = ( combinedField & ${ SAMPLE_CONVERGED_FLAG }u ) != 0u;
				if ( ( maxSamples != 0u && samples >= maxSamples ) || isConverged ) {

					atomicAdd( &${ params.counters }[ 0 ].finishedCount, 1u );

				}

				// the sum overflowed if it came out smaller than the value already there, so carry
				// the wrap into "totalHi"
				let previousTotal = atomicAdd( &${ params.counters }[ 0 ].totalLo, samples );
				if ( previousTotal + samples < previousTotal ) {

					atomicAdd( &${ params.counters }[ 0 ].totalHi, 1u );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
