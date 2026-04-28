import { Vector2, Vector3 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { queuedRayStruct, queueSizesStructFree } from './structs.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';

export class PrimeRayGenerationDispatchKernel extends ComputeKernel {

	constructor() {

		const params = {
			rayWorkGroupSize: uniform( new Vector3() ),

			tileSize: uniform( new Vector2() ),
			tileCount: uniform( new Vector2() ),
			tileOffset: uniform( 1 ),

			rayQueue: storage( new StorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ).toReadOnly(),
			queueSizes: storage( new StorageBufferAttribute( 1, 1 ), queueSizesStructFree ),

			outputTileIndex: storage( new StorageBufferAttribute( 2, 1 ), 'u32' ).setName( 'outputTileIndex' ),
			outputDispatch: storage( new StorageBufferAttribute( 3, 1 ), 'u32' ).setName( 'outputDispatch' ),
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute(
				rayWorkGroupSize: vec3u,

				tileSize: vec2u,
				tileCount: vec2u,
				tileOffset: u32,
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let queueSizes = &${ params.queueSizes };

				let outputTileIndex = &${ params.outputTileIndex };
				let outputDispatch = &${ params.outputDispatch };

				// reset hit queue size from previous iteration
				queueSizes.hitQueueStart = 0u;
				queueSizes.hitQueueEnd = 0u;

				// keep the queue index small
			  let queueCapacity = arrayLength( rayQueue );
				if ( queueSizes.rayQueueStart >= queueCapacity ) {

					// uint division results in a floored value
					let offset = queueSizes.rayQueueStart / queueCapacity;
					queueSizes.rayQueueStart = queueSizes.rayQueueStart - queueCapacity * offset;
					queueSizes.rayQueueEnd = queueSizes.rayQueueEnd - queueCapacity * offset;

				}

				// calculate the amount of elements in the queue
				let queueSize = queueSizes.rayQueueEnd - queueSizes.rayQueueStart;

				// calculate the overhead of space in the queue and how much space we need to run a new tile
				let overhead = queueCapacity - queueSize;
				let requiredSpace = tileSize.x * tileSize.y;

				if ( overhead >= requiredSpace ) {

					// calculate the necessary dispatch size to cover the tile
					outputDispatch[ 0 ] = u32( ceil( f32( tileSize.x ) / f32( rayWorkGroupSize.x ) ) );
					outputDispatch[ 1 ] = u32( ceil( f32( tileSize.y ) / f32( rayWorkGroupSize.y ) ) );
					outputDispatch[ 2 ] = 1;

					// calculate the tile index to generate rays for
					let totalTiles = tileCount.x * tileCount.y;
					let currentIndex = outputTileIndex[ 1 ] * tileCount.x + outputTileIndex[ 0 ];
					let nextIndex = ( currentIndex + tileOffset ) % totalTiles;

					outputTileIndex[ 0 ] = nextIndex % tileCount.x;
					outputTileIndex[ 1 ] = nextIndex / tileCount.x;

				} else {

					outputDispatch[ 0 ] = 0;
					outputDispatch[ 1 ] = 0;
					outputDispatch[ 2 ] = 0;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
