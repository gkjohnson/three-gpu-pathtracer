import { IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, wgslFn, textureStore, globalId } from 'three/tsl';
import { constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from '../../nodes/random.wgsl.js';
import { materialStruct } from '../../nodes/structs.wgsl.js';
import { getSurfaceRecordFunc, lambertBsdfFunc, pbrtBsdfFunc } from '../../nodes/material.wgsl.js';
import { queuedRayStruct, queuedHitStruct, QUEUED_RAY_SIZE, QUEUED_HIT_SIZE } from './structs.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, QUEUED_RAY_SIZE ), 'QueuedRay' ),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

			hitQueue: storage( new IndirectStorageBufferAttribute( 1, QUEUED_HIT_SIZE ), 'QueuedHit' ),
			hitQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),

			// bvh and geometry definition
			geom_position: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3f' ).toReadOnly(),
			geom_normals: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3f' ).toReadOnly(),
			materials: storage( new IndirectStorageBufferAttribute(), 'Material' ).toReadOnly(), // TODO: fill in initial values

			globalId: globalId,
		};

		const fn = wgslFn( /* wgsl */`

			fn compute(
				// indices and target
				prevOutputTarget: texture_storage_2d<rgba32float, read>,
				outputTarget: texture_storage_2d<rgba32float, write>,
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
				let hitQueueCapacity = arrayLength( hitQueue );
				let hitIndex = ( globalId.x + hitQueueSize[ 0 ] );
				if ( hitIndex >= hitQueueSize[ 1 ] ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				g_state.s0 = input.pcgStateS0;

				let material = materials[ input.materialIndex ];

				let a = geom_position[ input.indices.x ];
				let b = geom_position[ input.indices.y ];
				let c = geom_position[ input.indices.z ];

				let hitPosition = a * input.barycoord.x + b * input.barycoord.y + c * input.barycoord.z;
				let hitNormal = normalize( cross( c - a, b - a ) );

				let hit = IntersectionResult(
					/* didHit */ true,
					vec4u( input.indices, 0 ),
					hitNormal,
					input.barycoord,
					1.0, // input.side,
					/* dist */ 0,
				);

				// TODO: pass UVs
				let surf = getSurfaceRecord( material, hit, geom_normals, geom_normals );

				let scatterRec = bsdfSample( input.view, surf );

				// terminate ray if scatter is impossible or color is nan
				// TODO: Investigate ways to not generate such scatters
				if ( scatterRec.pdf <= 0 || any( scatterRec.color != scatterRec.color ) ) {

					let sampleCount = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) );
					textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );

					return;

				}

				if ( input.currentBounce >= bounces ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					var color = textureLoad( prevOutputTarget, indexUV ).xyz;
					color += ( vec3( 0 ) - color.xyz ) / f32( sampleCount );

					textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
					textureStore( outputTarget, indexUV, vec4( color, 1.0 ) );

				} else {

					let rayQueueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &rayQueueSize[ 1 ], 1 ) % rayQueueCapacity;
					rayQueue[ index ].ray.origin = hitPosition;
					rayQueue[ index ].ray.direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue[ index ].currentBounce = input.currentBounce + 1;
					rayQueue[ index ].pcgStateS0 = g_state.s0;

				}

			}
		`, [
			queuedRayStruct,
			getSurfaceRecordFunc,
			constants,
			getVertexAttribute,
			pcgRand3,
			pcgInit,
			queuedHitStruct,
			materialStruct,
			// lambertBsdfFunc,
			pbrtBsdfFunc,
		] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
