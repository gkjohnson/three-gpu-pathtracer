import { DataTexture, Matrix3, IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { texture, sampler, uniform, storage, wgslFn, textureStore, globalId } from 'three/tsl';
import { bvhIntersectFirstHit, constants } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgRand2, pcgInit } from '../../nodes/random.wgsl.js';
import { queuedRayStruct, queuedHitStruct, QUEUED_RAY_SIZE, QUEUED_HIT_SIZE } from './structs.js';
import { sampleEnvironmentFn } from '../../nodes/sampling.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, QUEUED_RAY_SIZE ), 'QueuedRay' ).toReadOnly(),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toReadOnly(),

			hitQueue: storage( new IndirectStorageBufferAttribute( 1, QUEUED_HIT_SIZE ), 'QueuedHit' ),
			hitQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

			// bvh and geometry definition
			geom_index: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3u' ).toReadOnly(),
			geom_position: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3f' ).toReadOnly(),
			geom_material_index: storage( new IndirectStorageBufferAttribute( 1, 1 ), 'u32' ).toReadOnly(),
			bvh: storage( new IndirectStorageBufferAttribute(), 'BVHNode' ).toReadOnly(), // TODO: fill in sizes

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),
			envMapBlur: uniform( 0 ),

			globalId: globalId,
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				// indices and target
				prevOutputTarget: texture_storage_2d<rgba32float, read>,
				outputTarget: texture_storage_2d<rgba32float, write>,
				sampleCountTarget: texture_storage_2d<r32uint, read_write>,

				// rays
				rayQueue: ptr<storage, array<QueuedRay>, read>,
				rayQueueSize: ptr<storage, array<u32>, read>,

				// hits
				hitQueue: ptr<storage, array<QueuedHit>, read_write>,
				hitQueueSize: ptr<storage, array<atomic<u32>>, read_write>,

				// scene
				geom_position: ptr<storage, array<vec3f>, read>,
				geom_index: ptr<storage, array<vec3u>, read>,
				geom_material_index: ptr<storage, array<u32>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,
				envMapBlur: f32,

				globalId: vec3u
			) -> void {

				let env = EnvironmentInfo(
					envMapRotation,
					envMapIntensity,
					envMapBlur,
				);

				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( rayQueue );
				let rayIndex = ( globalId.x + rayQueueSize[ 0 ] );
				if ( rayIndex >= rayQueueSize[ 1 ] ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = rayQueue[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;
				let seed = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + input.currentBounce;

				pcgInitialize( indexUV, seed );

				// run intersection
				let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, input.ray );
				if ( hitResult.didHit ) {

					// TODO: we process all of these materials immediately to push to the ray queue
					let materialIndex = geom_material_index[ hitResult.indices.x ];
					let index = atomicAdd( &hitQueueSize[ 1 ], 1 );
					hitQueue[ index ].view = - input.ray.direction;
					hitQueue[ index ].indices = hitResult.indices.xyz;
					hitQueue[ index ].barycoord = hitResult.barycoord;
					hitQueue[ index ].pixel_x = input.pixel.x;
					hitQueue[ index ].pixel_y = input.pixel.y;
					hitQueue[ index ].materialIndex = materialIndex;
					hitQueue[ index ].throughputColor = input.throughputColor;
					hitQueue[ index ].currentBounce = input.currentBounce;;

				} else {

					let background = sampleEnvironment( envMap, envMapSampler, env, input.ray.direction, pcgRand2() );
					let newColor = background * input.throughputColor;

					let sampleCount = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					var color = textureLoad( prevOutputTarget, indexUV ).xyz;
					color += ( newColor - color.xyz ) / f32( sampleCount );

					textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
					textureStore( outputTarget, indexUV, vec4( color, 1.0 ) );

				}

			}
		`, [ sampleEnvironmentFn, queuedRayStruct, bvhIntersectFirstHit, constants, pcgRand3, pcgRand2, pcgInit, queuedHitStruct ] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
