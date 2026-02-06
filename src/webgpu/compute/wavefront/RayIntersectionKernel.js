import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, wgslFn, textureStore, globalId, wgsl } from 'three/tsl';
import { queuedRayStruct } from './PrimeRayGenerationDispatchKernel.js';
import { bvhIntersectFirstHit, constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from '../../nodes/random.wgsl.js';

export const queuedHitStruct = wgsl( /* wgsl */`
	struct QueuedHit {
		normal: vec3f,
		pixel_x: u32,
		position: vec3f,
		pixel_y: u32,
		view: vec3f,
		currentBounce: u32,
		throughputColor: vec3f,
		vertexIndex: u32,
	};
` );

export class RayIntersectionKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			outputTarget: textureStore( new StorageTexture( 1, 1 ), 'vec4' ).toReadWrite(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ), 'u32' ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),

			// rays
			rayQueue: storage( new StorageBufferAttribute(), 'QueuedRay' ).toReadOnly(),
			rayQueueSize: storage( new StorageBufferAttribute(), 'uint' ).toReadOnly(),

			hitQueue: storage( new StorageBufferAttribute(), 'QueuedHit' ),
			hitQueueSize: storage( new StorageBufferAttribute(), 'uint' ).toAtomic(),

			// bvh and geometry definition
			geom_index: storage( new StorageBufferAttribute(), 'uvec3' ).toReadOnly(),
			geom_position: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_material_index: storage( new StorageBufferAttribute(), 'u32' ).toReadOnly(),
			bvh: storage( new StorageBufferAttribute(), 'BVHNode' ).toReadOnly(),
			materials: storage( new StorageBufferAttribute(), 'Material' ).toReadOnly(),

			globalId: globalId,
		};

		// geom_normals: ptr<storage, array<vec3f>, read>,
		// geom_material_index: ptr<storage, array<u32>, read>,
		// materials: ptr<storage, array<Material>, read>,

		const fn = wgslFn( /* wgsl */`

			fn compute(
				// indices and target
				outputTarget: texture_storage_2d<rgba32float, read_write>,
				sampleCountTarget: texture_storage_2d<r32uint, read_write>,

				// settings
				smoothNormals: u32,
				bounces: u32,

				// rays
				rayQueue: ptr<storage, array<QueuedRay>, read>,
				rayQueueSize: ptr<storage, array<u32>, read>,

				// hits
				hitQueue: ptr<storage, array<QueuedHit>, read_write>,
				hitQueueSize: ptr<storage, array<atomic<u32>>, read_write>,

				// scene
				geom_position: ptr<storage, array<vec3f>, read>,
				geom_index: ptr<storage, array<vec3u>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,

				globalId: vec3u
			) -> void {

				// TODO: is this needed?
				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( rayQueue );
				let rayIndex = ( globalId.x + rayQueueSize[ 0 ] );
				if ( rayIndex >= rayQueueSize[ 1 ] ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let info = rayQueue[ rayIndex % queueCapacity ];
				let indexUV = info.pixel;
				let seed = ( textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + info.currentBounce;

				pcgInitialize( indexUV, seed );

				// run intersection
				let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, info.ray );
				if ( hitResult.didHit ) {

					// // TODO: we process all of these materials immediately to push to the ray queue
					// let materialIndex = geom_material_index[ hitResult.indices.x ];
					// let hitPosition = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
					// let hitNormal = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );

					// let index = atomicAdd( &hitQueueSize[ 1 ], 1 );
					// outputQueue[index].view = - input.ray.direction;
					// outputQueue[index].normal = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );
					// outputQueue[index].position = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
					// outputQueue[index].pixel_x = input.pixel.x;
					// outputQueue[index].pixel_y = input.pixel.y;
					// outputQueue[index].vertexIndex = hitResult.indices.x;
					// outputQueue[index].throughputColor = input.throughputColor;
					// outputQueue[index].currentBounce = input.currentBounce;


					let c = textureLoad( outputTarget, indexUV ) + vec4( 0.1, 0, 0, 1 );
					textureStore( outputTarget, indexUV, c );
					textureStore( sampleCountTarget, indexUV, vec4( 0 ) );

				} else {

					textureStore( outputTarget, indexUV, vec4( 0, 0, 1, 1 ) );

					// let background = vec3f( 0.5 );
					// let newColor = background * info.throughputColor;

					// let sampleCount = textureLoad( sampleCountTarget, indexUV ).r & ( ~ ACTIVE_FLAG ) + 1;
					// var color = textureLoad( outputTarget, indexUV ).xyz;
					// color += ( newColor - color.xyz ) / f32( sampleCount );

					// textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
					// textureStore( outputTarget, indexUV, vec4( color, 1.0 ) );

				}

			}
		`, [ queuedRayStruct, bvhIntersectFirstHit, constants, getVertexAttribute, pcgRand3, pcgInit, queuedHitStruct ] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
