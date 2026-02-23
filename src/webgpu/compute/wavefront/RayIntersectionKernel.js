import { IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, wgslFn, textureStore, globalId } from 'three/tsl';
import { pcgRand3, pcgInit } from '../../nodes/random.wgsl.js';
import { queuedRayStruct, queuedHitStruct, QUEUED_RAY_SIZE, QUEUED_HIT_SIZE } from './structs.js';
import { proxy } from '../../lib/nodes/NodeProxy.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, QUEUED_RAY_SIZE ), 'QueuedRay' ).toReadOnly(),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toReadOnly(),

			hitQueue: storage( new IndirectStorageBufferAttribute( 1, QUEUED_HIT_SIZE ), 'QueuedHit' ),
			hitQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

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

				globalId: vec3u
			) -> void {

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
				let hitResult = bvh_RaycastFirstHit( input.ray );
				if ( hitResult.didHit ) {

					// TODO: we process all of these materials immediately to push to the ray queue
					let index = atomicAdd( &hitQueueSize[ 1 ], 1 );
					hitQueue[ index ].view = - input.ray.direction;
					hitQueue[ index ].indices = hitResult.indices.xyz;
					hitQueue[ index ].barycoord = hitResult.barycoord;
					hitQueue[ index ].pixel_x = input.pixel.x;
					hitQueue[ index ].pixel_y = input.pixel.y;
					hitQueue[ index ].objectIndex = hitResult.objectIndex;
					hitQueue[ index ].throughputColor = input.throughputColor;
					hitQueue[ index ].currentBounce = input.currentBounce;;

				} else {

					let background = vec3f( 0.5 );
					let newColor = background * input.throughputColor;

					let sampleCount = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					var color = textureLoad( prevOutputTarget, indexUV ).xyz;
					color += ( newColor - color.xyz ) / f32( sampleCount );

					textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
					textureStore( outputTarget, indexUV, vec4( color, 1.0 ) );

				}

			}
		`, [
			proxy( 'bvhData.value.fns.raycastFirstHit', parameters ),
			proxy( 'bvhData.value.structs.material', parameters ),
			queuedRayStruct, pcgRand3, pcgInit, queuedHitStruct ] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
