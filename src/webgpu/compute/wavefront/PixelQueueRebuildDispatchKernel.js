import { Vector2 } from 'three';
import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { pixelQueueInfoStruct } from './structs.js';

// Once the pixel queue is used up, empties it and writes the dispatch size of its rebuild. Otherwise the
// rebuild is dispatched with no threads.
export class PixelQueueRebuildDispatchKernel extends ComputeKernel {

	constructor( workgroupSize = 8 ) {

		const params = {
			targetDimensions: uniform( new Vector2() ),
			pixelQueueInfo: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueInfoStruct ),
			outputDispatch: storage( new IndirectStorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( targetDimensions: vec2u ) -> void {

				let outputDispatch = &${ params.outputDispatch };

				let frontCount = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].frontCount );
				let backCount = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].backCount );
				let frontCursor = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].frontCursor );
				let backCursor = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].backCursor );
				let isPassComplete = frontCursor >= frontCount && backCursor >= backCount;

				let groups = ( targetDimensions + vec2u( ${ workgroupSize - 1 }u ) ) / ${ workgroupSize }u;
				outputDispatch[ 0 ] = select( 0u, groups.x, isPassComplete );
				outputDispatch[ 1 ] = select( 0u, groups.y, isPassComplete );
				outputDispatch[ 2 ] = 1u;

				if ( isPassComplete ) {

					// split at the middle of the sample range the last rebuild recorded, if any
					let minSamples = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].minSamples );
					let maxSamples = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].maxSamples );
					atomicStore( &${ params.pixelQueueInfo }[ 0 ].sampleCountMidpoint, select( ( minSamples + maxSamples ) / 2u, 0u, minSamples > maxSamples ) );

					atomicStore( &${ params.pixelQueueInfo }[ 0 ].frontCount, 0u );
					atomicStore( &${ params.pixelQueueInfo }[ 0 ].backCount, 0u );
					atomicStore( &${ params.pixelQueueInfo }[ 0 ].frontCursor, 0u );
					atomicStore( &${ params.pixelQueueInfo }[ 0 ].backCursor, 0u );
					atomicStore( &${ params.pixelQueueInfo }[ 0 ].minSamples, 0xFFFFFFFFu );
					atomicStore( &${ params.pixelQueueInfo }[ 0 ].maxSamples, 0u );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
