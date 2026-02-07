import { Vector2, Vector3 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { wgslFn, wgsl, uniform, storage } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { rayStruct } from 'three-mesh-bvh/webgpu';

export const queuedRayStruct = wgsl( /* wgsl */ `
	struct QueuedRay {
		ray: Ray,
		throughputColor: vec3f,
		currentBounce: u32,
		pixel: vec2u,
	};
`, [ rayStruct ] );

export class PrimeRayGenerationDispatchKernel extends ComputeKernel {

	constructor() {

		const params = {
			rayWorkGroupSize: uniform( new Vector3() ),
			tileSize: uniform( new Vector2() ),
			tileCount: uniform( new Vector2() ),
			rayQueue: storage( new StorageBufferAttribute(), 'QueuedRay' ).toReadOnly(),
			rayQueueSize: storage( new StorageBufferAttribute(), 'uint' ),

			outputTileIndex: storage( new StorageBufferAttribute(), 'uint' ),
			outputDispatch: storage( new StorageBufferAttribute(), 'uint' ),
		};

		const kernel = wgslFn( /* wgsl */`
			fn compute(
				rayWorkGroupSize: vec3u,
				tileSize: vec2u,
				tileCount: vec2u,
				rayQueue: ptr<storage, array<QueuedRay>, read>,
				rayQueueSize: ptr<storage, array<u32>, read_write>,

				outputTileIndex: ptr<storage, array<u32>, read_write>,
				outputDispatch: ptr<storage, array<u32>, read_write>,
			) -> void {

				// keep the queue index small
			    let queueCapacity = arrayLength( rayQueue );
				if ( rayQueueSize[ 0 ] >= queueCapacity ) {

					// uint division results in a floored value
					let offset = rayQueueSize[ 0 ] / queueCapacity;
					rayQueueSize[ 0 ] = rayQueueSize[ 0 ] - queueCapacity * offset;
					rayQueueSize[ 1 ] = rayQueueSize[ 1 ] - queueCapacity * offset;

				}

				// calculate the amount of elements in the queue
			    var queueSize = rayQueueSize[ 1 ] - rayQueueSize[ 0 ];

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
					let nextIndex = ( currentIndex + 1 ) % totalTiles;

					outputTileIndex[ 0 ] = nextIndex % tileCount.x;
					outputTileIndex[ 1 ] = nextIndex / tileCount.x;

				} else {

					outputDispatch[ 0 ] = 0;
					outputDispatch[ 1 ] = 0;
					outputDispatch[ 2 ] = 0;

				}

			}
		`, [ queuedRayStruct ] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
