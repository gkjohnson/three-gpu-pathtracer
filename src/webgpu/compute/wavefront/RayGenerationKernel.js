import { Vector2 } from 'three';
import { IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { uniform, storage, globalId, textureStore } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { rngInit, rand2, RNG_INDEX_RAY_JITTER } from '../../nodes/random.wgsl.js';
import { queuedRayStruct } from './structs.js';
import { proxyFn, wgslTagFn } from '../../lib/three-mesh-bvh/index.js';

export class RayGenerationKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },

			seed: uniform( 0 ),

			tileIndexBuffer: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),
			tileSize: uniform( new Vector2() ),

			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ).toAtomic(),

			sampleCountTarget: textureStore( new StorageTexture() ).toReadWrite(),

			globalId: globalId,
		};

		const getCameraRayFn = proxyFn( 'bvhData.value.fns.getCameraRay', params );

		const fn = wgslTagFn /* wgsl */`
			fn compute(
				seed: u32,
				tileSize: vec2u,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let queueSizes = &${ params.queueSizes };
				let tileIndexBuffer = &${ params.tileIndexBuffer };

				// don't overstep the edge of the tile
				if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {

					return;

				}

				// calculate the pixel index and ensure we are not generating rays outside the texture bounds
				let offset = vec2( tileIndexBuffer[ 0 ] * tileSize.x, tileIndexBuffer[ 1 ] * tileSize.y );
				let indexUV = offset + globalId.xy;
				let targetDimensions = textureDimensions( ${ params.sampleCountTarget } );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				// calculate the screen uv
				let uv = vec2f( indexUV ) / vec2f( targetDimensions );

				// check whether ray is already active (added on the queue) and skip it if it is
				let ACTIVE_FLAG = 0xF0000000u;
				let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
				let isActive = ( ACTIVE_FLAG & combinedField ) != 0;
				let samples = ( ( ~ ACTIVE_FLAG ) & combinedField );

				if ( isActive ) {

					return;

				}

				// get the ray index
				let queueCapacity = arrayLength( rayQueue );
				let index = atomicAdd( &queueSizes[ 1 ], 1 ) % queueCapacity;

				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ rngInit }( pixelIndex, seed, 0 );

				// write the ray data - the camera supplies its own uv -> ray function ( bvhData.fns.getCameraRay )
				let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
				var ray = ${ getCameraRayFn }( jitteredUv );
				ray.direction = normalize( ray.direction );

				rayQueue[ index ].origin = ray.origin;
				rayQueue[ index ].direction = ray.direction;
				rayQueue[ index ].pixel = indexUV;
				rayQueue[ index ].throughputColor = vec3f( 1.0 );
				rayQueue[ index ].currentBounce = 0;
				rayQueue[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
				rayQueue[ index ].seed = seed;

				// write the active params
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ACTIVE_FLAG | samples ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
