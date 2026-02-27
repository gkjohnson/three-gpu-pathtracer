import { IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, wgslFn, textureStore, globalId } from 'three/tsl';
import { pcgRand3, pcgInit } from '../../nodes/random.wgsl.js';
import { getSurfaceRecordFunc, lambertBsdfFunc } from '../../nodes/material.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy } from '../../lib/nodes/NodeProxy.js';
import { weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), 'QueuedRay' ),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), 'QueuedHit' ),
			hitQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),

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

				let object = bvh_transforms.value[ input.objectIndex ];
				var material = bvh_materials.value[ object.materialIndex ];

				// apply per-object colors
				material.color *= object.color.rgb;
				material.opacity *= object.color.a;

				var vertexData = bvh_sampleTrianglePoint( input.barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = object.matrixWorld * vertexData.position;

				let surface = getSurfaceRecord( material, vertexData, input.side, input.normal );

				let scatterRec = bsdfSample( input.view, surface );

				if ( input.currentBounce >= bounces ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( prevOutputTarget, indexUV );
					let blendedColor = weightedAlphaBlend( prevColor, vec4f( 0, 0, 0, 1 ), 1.0 / f32( sampleCount ) );
					textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
					textureStore( outputTarget, indexUV, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &rayQueueSize[ 1 ], 1 ) % rayQueueCapacity;
					rayQueue[ index ].origin = vertexData.position.xyz;
					rayQueue[ index ].direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue[ index ].currentBounce = input.currentBounce + 1;
					rayQueue[ index ].pcgStateS0 = g_state.s0;

				}

			}
		`, [
			proxy( 'bvhData.value.structs.material', parameters ),
			proxy( 'bvhData.value.structs.transform', parameters ),
			proxy( 'bvhData.value.storage.materials', parameters ),
			proxy( 'bvhData.value.storage.transforms', parameters ),
			proxy( 'bvhData.value.fns.sampleTrianglePoint', parameters ),
			queuedRayStruct, lambertBsdfFunc, getSurfaceRecordFunc,
			pcgRand3, pcgInit, queuedHitStruct,
			weightedAlphaBlendFn,
		] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
