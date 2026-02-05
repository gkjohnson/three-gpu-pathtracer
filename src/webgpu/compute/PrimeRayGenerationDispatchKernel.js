import { Vector2, Vector3 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { wgslFn, wgsl, uniform, storage, uint } from 'three/tsl';
import { ComputeKernel } from './ComputeKernel.js';
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
			rayQueueSize: storage( new StorageBufferAttribute(), 'uint' ).toReadOnly(),

			outputTileIndex: storage( new StorageBufferAttribute(), 'uint' ),
			outputDispatch: storage( new StorageBufferAttribute(), 'uint' ),
		};

		const kernel = wgslFn( /* wgsl */`
			fn compute(
				rayWorkGroupSize: vec3u,
				tileSize: vec2u,
				tileCount: vec2u,
				rayQueue: ptr<storage, array<QueuedRay>, read>,
				rayQueueSize: ptr<storage, array<u32>, read>,

				outputTileIndex: ptr<storage, array<u32>, read_write>,
				outputDispatch: ptr<storage, array<u32>, read_write>,
			) -> void {

			    let queueCapacity = arrayLength( rayQueue );
				let queueSize = rayQueueSize[ 1 ];
				let overhead = queueCapacity - queueSize;
				let requiredSpace = tileSize.x * tileSize.y;
				if ( overhead >= requiredSpace ) {

					outputDispatch[ 0 ] = u32( ceil( f32( tileSize.x ) / f32( rayWorkGroupSize.x ) ) );
					outputDispatch[ 1 ] = u32( ceil( f32( tileSize.y ) / f32( rayWorkGroupSize.y ) ) );
					outputDispatch[ 2 ] = 1;

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
