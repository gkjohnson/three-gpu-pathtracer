import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, wgslFn, textureStore, u32, globalId } from 'three/tsl';
import { queuedRayStruct } from './PrimeRayGenerationDispatchKernel.js';
import { bvhIntersectFirstHit, constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from './random.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			outputTarget: textureStore( new StorageTexture( 1, 1 ), 'vec4' ).toReadWrite(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ), 'u32' ).toReadWrite(),

			// settings
			smoothNormals: uniform( u32() ),
			bounces: uniform( u32() ),

			// rays
			rayQueue: storage( new StorageBufferAttribute(), 'QueuedRay' ).toReadOnly(),
			rayQueueSize: storage( new StorageBufferAttribute(), 'uint' ).toReadOnly(),

			// bvh and geometry definition
			geom_index: storage( new StorageBufferAttribute(), 'uvec3' ).toReadOnly(),
			geom_position: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_material_index: storage( new StorageBufferAttribute(), 'u32' ).toReadOnly(),
			bvh: storage( new StorageBufferAttribute(), 'BVHNode' ).toReadOnly(),
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
				rayQueueSize: ptr<storage, array<u32>, read>,

				// scene
				geom_position: ptr<storage, array<vec3f>, read>,
				geom_index: ptr<storage, array<vec3u>, read>,
				geom_normals: ptr<storage, array<vec3f>, read>,
				geom_material_index: ptr<storage, array<u32>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,
				materials: ptr<storage, array<Material>, read>,
			) -> void {

				// TODO: skip any rays invocations beyond the ray count
				// TODO: need to set up indirect buffer instead


			}
		`, [ queuedRayStruct, bvhIntersectFirstHit, constants, getVertexAttribute, pcgRand3, pcgInit ] );

		super( fn( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
