import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { SAMPLE_COUNT_MASK } from '../../constants.js';
import { PIXEL_QUEUE_CURRENT, PIXEL_QUEUE_DROPPED, PIXEL_QUEUE_DROPPED_COUNT, PIXEL_QUEUE_ELEMENT_COUNT, PIXEL_QUEUE_HEADER } from './structs.js';

// the queue is compacted once this share of its entries are dropped
const PIXEL_QUEUE_COMPACT_RATIO = 0.25;

const WORKGROUP_SIZE = 64;

// Returns a function, `( pixelIndex, maxSamples ) -> bool`, telling whether a pixel has all its samples
export function getPixelFinishedFn( sampleCountTarget ) {

	return wgslTagFn/* wgsl */`
		fn isPixelFinished( pixelIndex: u32, maxSamples: u32 ) -> bool {

			let samples = textureLoad( ${ sampleCountTarget }, vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF ) ).r & ${ SAMPLE_COUNT_MASK }u;
			return maxSamples != 0u && samples >= maxSamples;

		}
	`;

}

// Writes the indirect dispatch size of the compaction: a thread per queue entry once the dropped entries reach
// PIXEL_QUEUE_COMPACT_RATIO of the queue, nothing otherwise. Empties the compacted queue for the pass to fill.
export class PixelQueueCompactionDispatchKernel extends ComputeKernel {

	constructor() {

		const params = {
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			compactedPixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'compactionDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute() -> void {

				let pixelQueue = &${ params.pixelQueue };
				let outputDispatch = &${ params.outputDispatch };

				let elementCount = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ] );
				let droppedCount = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_DROPPED_COUNT }u ] );
				let isCompacting = elementCount > 0u && f32( droppedCount ) >= f32( elementCount ) * ${ PIXEL_QUEUE_COMPACT_RATIO };
				outputDispatch[ 0 ] = select( 0u, ( elementCount + ${ WORKGROUP_SIZE - 1 }u ) / ${ WORKGROUP_SIZE }u, isCompacting );
				outputDispatch[ 1 ] = 1u;
				outputDispatch[ 2 ] = 1u;

				atomicStore( &${ params.compactedPixelQueue }[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 0u );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}

// Copies the queue's entries that still need samples into the compacted queue, dropping the rest.
// TODO: the atomic append doesn't keep the entries' order, so neighboring pixels may no longer be traced together
export class CompactPixelQueueKernel extends ComputeKernel {

	constructor() {

		const params = {
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			compactedPixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadOnly(),
			maxSamples: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const isPixelFinishedFn = getPixelFinishedFn( params.sampleCountTarget );

		const fn = wgslTagFn/* wgsl */`
			fn compute( maxSamples: u32, globalId: vec3u ) -> void {

				let pixelQueue = &${ params.pixelQueue };
				let compactedPixelQueue = &${ params.compactedPixelQueue };

				let index = globalId.x;
				if ( index >= atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ] ) ) {

					return;

				}

				let pixelIndex = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + index ] );
				if ( pixelIndex == ${ PIXEL_QUEUE_DROPPED }u || ${ isPixelFinishedFn }( pixelIndex, maxSamples ) ) {

					return;

				}

				let compactedIndex = atomicAdd( &compactedPixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 1u );
				atomicStore( &compactedPixelQueue[ ${ PIXEL_QUEUE_HEADER }u + compactedIndex ], pixelIndex );

			}
		`;

		super( fn( params ), { workgroupSize: [ WORKGROUP_SIZE ] } );

		this.defineUniformAccessors( params );

	}

}

// Copies the compacted queue back over the queue and restarts it from its first entry. Dispatched with the
// compaction's size, which covers the shorter compacted queue.
export class CopyCompactedPixelQueueKernel extends ComputeKernel {

	constructor() {

		const params = {
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			compactedPixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				let pixelQueue = &${ params.pixelQueue };
				let compactedPixelQueue = &${ params.compactedPixelQueue };

				let index = globalId.x;
				let elementCount = atomicLoad( &compactedPixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ] );
				if ( index == 0u ) {

					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_CURRENT }u ], 0u );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], elementCount );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_DROPPED_COUNT }u ], 0u );

				}

				if ( index < elementCount ) {

					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + index ], atomicLoad( &compactedPixelQueue[ ${ PIXEL_QUEUE_HEADER }u + index ] ) );

				}

			}
		`;

		super( fn( params ), { workgroupSize: [ WORKGROUP_SIZE ] } );

		this.defineUniformAccessors( params );

	}

}
