import { StorageBufferAttribute, StorageTexture, StructTypeNode } from 'three/webgpu';
import { storage, textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from './ComputeKernel.js';

// Layout of the r32uint "sample count" target. The top two bits are flags, the remaining 30 hold
// the per pixel sample count.

// A ray for this pixel is currently on the queue, so a second one must not be generated for it.
export const SAMPLE_ACTIVE_FLAG = 0x80000000;

// A camera ray has been generated for this pixel at least once. Pixels that never get one - the
// empty space between array camera viewports, for example - are skipped when tallying sample
// counts so they can't drag the minimum and average down.
export const SAMPLE_DISPATCHED_FLAG = 0x40000000;

export const SAMPLE_COUNT_MASK = 0x3FFFFFFF;

// Field order of the sample counter buffer, matching the struct below.
export const SAMPLE_COUNTER_MIN = 0;
export const SAMPLE_COUNTER_MAX = 1;
export const SAMPLE_COUNTER_TOTAL_LO = 2;
export const SAMPLE_COUNTER_TOTAL_HI = 3;
export const SAMPLE_COUNTER_PIXEL_COUNT = 4;
export const SAMPLE_COUNTER_LENGTH = 5;

// The number of values a u32 can hold, used to recombine the split total on read.
export const U32_RANGE = 4294967296;

// Reduction target for the per pixel sample counts. The summed count outgrows 32 bits after a few
// thousand samples at high resolutions, so it accumulates as a 64 bit value split across
// "totalLo" and "totalHi" and is reassembled on the CPU.
export const sampleCountersStruct = new StructTypeNode( {
	minSamples: { type: 'uint', atomic: true },
	maxSamples: { type: 'uint', atomic: true },
	totalLo: { type: 'uint', atomic: true },
	totalHi: { type: 'uint', atomic: true },
	pixelCount: { type: 'uint', atomic: true },
}, 'SampleCounters' );

// Clears the sample counter buffer ahead of the tally. "minSamples" starts at the largest value a
// u32 can hold so the first "atomicMin" always replaces it.
export class PrimeSampleCountersKernel extends ComputeKernel {

	constructor() {

		const params = {
			counters: storage( new StorageBufferAttribute( 1, 1 ), sampleCountersStruct ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				atomicStore( &${ params.counters }.minSamples, 0xFFFFFFFFu );
				atomicStore( &${ params.counters }.maxSamples, 0u );
				atomicStore( &${ params.counters }.totalLo, 0u );
				atomicStore( &${ params.counters }.totalHi, 0u );
				atomicStore( &${ params.counters }.pixelCount, 0u );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}

// Reduces the per pixel sample count target down to a min, max, and total so the CPU can read back
// a handful of values instead of the whole texture.
export class TallySampleCountsKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			counters: storage( new StorageBufferAttribute( 1, 1 ), sampleCountersStruct ),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				let targetDimensions = textureDimensions( ${ params.sampleCountTarget } );
				if ( globalId.x >= targetDimensions.x || globalId.y >= targetDimensions.y ) {

					return;

				}

				// pixels that have never had a camera ray dispatched are not part of the image, so
				// they're skipped rather than counted as having zero samples
				let combinedField = textureLoad( ${ params.sampleCountTarget }, globalId.xy ).r;
				if ( ( combinedField & ${ SAMPLE_DISPATCHED_FLAG }u ) == 0u ) {

					return;

				}

				let samples = combinedField & ${ SAMPLE_COUNT_MASK }u;

				atomicMin( &${ params.counters }.minSamples, samples );
				atomicMax( &${ params.counters }.maxSamples, samples );
				atomicAdd( &${ params.counters }.pixelCount, 1u );

				// u32 addition wraps silently, so a sum that lands below the value already in the
				// low word means it overflowed exactly once and the high word carries
				let previousTotal = atomicAdd( &${ params.counters }.totalLo, samples );
				if ( previousTotal + samples < previousTotal ) {

					atomicAdd( &${ params.counters }.totalHi, 1u );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
