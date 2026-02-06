import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, wgslFn, textureStore, globalId } from 'three/tsl';
import { queuedRayStruct } from './PrimeRayGenerationDispatchKernel.js';
import { constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from '../../nodes/random.wgsl.js';
import { queuedHitStruct } from './RayIntersectionKernel.js';
import { materialStruct } from '../../nodes/structs.wgsl.js';
import { lambertBsdfFunc } from '../../nodes/sampling.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			outputTarget: textureStore( new StorageTexture( 1, 1 ), 'vec4' ).toReadWrite(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ), 'u32' ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),

			// rays
			rayQueue: storage( new StorageBufferAttribute(), 'QueuedRay' ),
			rayQueueSize: storage( new StorageBufferAttribute(), 'uint' ).toAtomic(),

			hitQueue: storage( new StorageBufferAttribute(), 'QueuedHit' ),
			hitQueueSize: storage( new StorageBufferAttribute(), 'uint' ),

			// bvh and geometry definition
			geom_position: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			materials: storage( new StorageBufferAttribute(), 'Material' ).toReadOnly(),

			globalId: globalId,
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				// indices and target
				outputTarget: texture_storage_2d<rgba32float, read_write>,
				sampleCountTarget: texture_storage_2d<r32uint, read_write>,

				// settings
				smoothNormals: u32,
				bounces: u32,

				// rays
				rayQueue: ptr<storage, array<QueuedRay>, read_write>,
				rayQueueSize: ptr<storage, array<atomic<u32>>, read_write>,

				// hits
				hitQueue: ptr<storage, array<QueuedHit>, read_write>,
				hitQueueSize: ptr<storage, array<u32>, read_write>,

				// scene
				geom_position: ptr<storage, array<vec3f>, read>,
				geom_normals: ptr<storage, array<vec3f>, read>,
				materials: ptr<storage, array<Material>, read>,

				globalId: vec3u
			) -> void {

				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( hitQueue );
				let hitIndex = ( globalId.x + hitQueueSize[ 0 ] );
				if ( hitIndex >= hitQueueSize[ 1 ] ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue[ hitIndex % queueCapacity ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				let seed = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + input.currentBounce;

				pcgInitialize( indexUV, seed );

				let material = materials[ input.materialIndex ];
				let hitPosition = getVertexAttribute( input.barycoord, input.indices.xyz, geom_position );
				let hitNormal = getVertexAttribute( input.barycoord, input.indices.xyz, geom_normals );
				let scatterRec = bsdfEval( hitNormal, input.view );

				if ( input.currentBounce > bounces ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					var color = textureLoad( outputTarget, indexUV ).xyz;
					color += ( vec3( 0 ) - color.xyz ) / f32( sampleCount );

					textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
					textureStore( outputTarget, indexUV, vec4( color, 1.0 ) );

				} else {

					let queueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &rayQueueSize[ 1 ], 1 ) % queueCapacity;
					rayQueue[ index ].ray.origin = hitPosition;
					rayQueue[ index ].ray.direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = input.throughputColor * material.albedo * scatterRec.value / scatterRec.pdf;
					rayQueue[ index ].currentBounce = input.currentBounce + 1;

				}

			}
		`, [ queuedRayStruct, lambertBsdfFunc, constants, getVertexAttribute, pcgRand3, pcgInit, queuedHitStruct, materialStruct ] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
