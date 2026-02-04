import { StorageBufferAttribute, Matrix4, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { uniform, storage, globalId, textureStore } from 'three/tsl';
import megakernelShader from '../nodes/megakernel.wgsl.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor() {

		const megakernelShaderParams = {
			resultBuffer: storage( new StorageBufferAttribute(), 'vec4' ),
			sampleCountBuffer: storage( new StorageBufferAttribute(), 'u32' ),

			resultBuffer2: textureStore( new StorageTexture( 1, 1 ), 'vec4' ).toReadWrite(),
			sampleCountBuffer2: textureStore( new StorageTexture( 1, 1 ), 'u32' ).toReadWrite(),

			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( new Vector2() ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),
			bounces: uniform( 5 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			geom_index: storage( new StorageBufferAttribute(), 'uvec3' ).toReadOnly(),
			geom_position: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute(), 'vec3' ).toReadOnly(),
			geom_material_index: storage( new StorageBufferAttribute(), 'u32' ).toReadOnly(),
			bvh: storage( new StorageBufferAttribute(), 'BVHNode' ).toReadOnly(),

			materials: storage( new StorageBufferAttribute(), 'Material' ).toReadOnly(),

			// compute variables
			globalId: globalId,
		};

		super( megakernelShader( megakernelShaderParams ) );

	}

}
