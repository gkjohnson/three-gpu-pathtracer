import { Vector2 } from 'three';
import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import {
	PIXEL_QUEUE_FRONT_COUNT, PIXEL_QUEUE_BACK_COUNT, PIXEL_QUEUE_FRONT_CURSOR, PIXEL_QUEUE_BACK_CURSOR,
	PIXEL_QUEUE_MIN_SAMPLES, PIXEL_QUEUE_MAX_SAMPLES, PIXEL_QUEUE_SAMPLE_SPLIT,
} from './structs.js';

// Once the pixel queue is used up, empties it and writes the dispatch size of its rebuild. Otherwise the
// rebuild is dispatched with no threads.
export class PixelQueueRebuildDispatchKernel extends ComputeKernel {

	constructor( workgroupSize = 8 ) {

		const params = {
			targetDimensions: uniform( new Vector2() ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( targetDimensions: vec2u ) -> void {

				let pixelQueue = &${ params.pixelQueue };
				let outputDispatch = &${ params.outputDispatch };

				let frontCount = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_FRONT_COUNT }u ] );
				let backCount = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_BACK_COUNT }u ] );
				let frontCursor = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_FRONT_CURSOR }u ] );
				let backCursor = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_BACK_CURSOR }u ] );
				let isPassComplete = frontCursor >= frontCount && backCursor >= backCount;

				let groups = ( targetDimensions + vec2u( ${ workgroupSize - 1 }u ) ) / ${ workgroupSize }u;
				outputDispatch[ 0 ] = select( 0u, groups.x, isPassComplete );
				outputDispatch[ 1 ] = select( 0u, groups.y, isPassComplete );
				outputDispatch[ 2 ] = 1u;

				if ( isPassComplete ) {

					// split at the middle of the sample range the last rebuild recorded, if any
					let minSamples = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_MIN_SAMPLES }u ] );
					let maxSamples = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_MAX_SAMPLES }u ] );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_SAMPLE_SPLIT }u ], select( minSamples + maxSamples, 0u, minSamples > maxSamples ) );

					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_FRONT_COUNT }u ], 0u );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_BACK_COUNT }u ], 0u );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_FRONT_CURSOR }u ], 0u );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_BACK_CURSOR }u ], 0u );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_MIN_SAMPLES }u ], 0xFFFFFFFFu );
					atomicStore( &pixelQueue[ ${ PIXEL_QUEUE_MAX_SAMPLES }u ], 0u );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
