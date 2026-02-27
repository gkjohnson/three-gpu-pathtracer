import { Vector2, Matrix4 } from 'three';
import { IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { wgslFn, uniform, storage, globalId, textureStore } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { ndcToCameraRay } from '../../lib/wgsl/common.wgsl.js';
import { pcgInit, pcgRand2 } from '../../nodes/random.wgsl.js';
import { queuedRayStruct } from './structs.js';

export class RayGenerationKernel extends ComputeKernel {

	constructor() {

		const params = {
			cameraToModelMatrix: uniform( new Matrix4() ),
			inverseProjectionMatrix: uniform( new Matrix4() ),

			seed: uniform( 0 ),

			tileIndexBuffer: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),
			tileSize: uniform( new Vector2() ),

			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), 'QueuedRay' ),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

			sampleCountTarget: textureStore( new StorageTexture() ).toReadWrite(),

			globalId: globalId,
		};

		const kernel = wgslFn( /* wgsl */`
			fn compute(
				cameraToModelMatrix: mat4x4f,
				inverseProjectionMatrix: mat4x4f,

				seed: u32,

				tileIndexBuffer: ptr<storage, array<u32>, read_write>,
				tileSize: vec2u,

				rayQueue: ptr<storage, array<QueuedRay>, read_write>,
				rayQueueSize: ptr<storage, array<atomic<u32>>, read_write>,

				sampleCountTarget: texture_storage_2d<r32uint, read_write>,

				globalId: vec3u
			) -> void {

				// don't overstep the edge of the tile
				if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {

					return;

				}

				// calculate the pixel index and ensure we are not generating rays outside the texture bounds
				let offset = vec2( tileIndexBuffer[ 0 ] * tileSize.x, tileIndexBuffer[ 1 ] * tileSize.y );
				let indexUV = offset + globalId.xy;
				let targetDimensions = textureDimensions( sampleCountTarget );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				// calculate the screen uv
				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				// check whether ray is already active (added on the queue) and skip it if it is
				let ACTIVE_FLAG = 0xF0000000u;
				let combinedField = textureLoad( sampleCountTarget, indexUV ).r;
				let isActive = ( ACTIVE_FLAG & combinedField ) != 0;
				let samples = ( ( ~ ACTIVE_FLAG ) & combinedField );

				if ( isActive ) {

					return;

				}

				// get the ray index
				let queueCapacity = arrayLength( rayQueue );
				let index = atomicAdd( &rayQueueSize[ 1 ], 1 ) % queueCapacity;

				pcgInitialize( indexUV, seed );

				// write the ray data
				var jitter = 2.0 * ( pcgRand2() - vec2( 0.5 ) ) / vec2f( targetDimensions.xy );
				var ray = ndcToCameraRay( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );
				ray.direction = normalize( ray.direction );

				rayQueue[ index ].origin = ray.origin;
				rayQueue[ index ].direction = ray.direction;
				rayQueue[ index ].pixel = indexUV;
				rayQueue[ index ].throughputColor = vec3f( 1.0 );
				rayQueue[ index ].currentBounce = 0;

				// write the active params
				textureStore( sampleCountTarget, indexUV, vec4( ACTIVE_FLAG | samples ) );

			}
		`, [ queuedRayStruct, ndcToCameraRay, pcgInit, pcgRand2 ] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
