import { Matrix3, DataTexture, IndirectStorageBufferAttribute, Matrix4, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, storage, globalId, textureStore } from 'three/tsl';
import megakernelShader from '../nodes/megakernel.wgsl.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor() {

		const megakernelShaderParams = {
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),
			bounces: uniform( 5 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			background: texture( new DataTexture() ),
			backgroundSampler: sampler( new DataTexture() ),
			backgroundRotation: uniform( new Matrix3() ),
			backgroundIntensity: uniform( 1 ),
			backgroundMapBlur: uniform( 0 ),

			// bvh and geometry definition
			geom_index: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3u' ).toReadOnly(),
			geom_position: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3f' ).toReadOnly(),
			geom_normals: storage( new IndirectStorageBufferAttribute( 1, 3 ), 'vec3f' ).toReadOnly(),
			geom_material_index: storage( new IndirectStorageBufferAttribute( 1, 1 ), 'u32' ).toReadOnly(),
			bvh: storage( new IndirectStorageBufferAttribute(), 'BVHNode' ).toReadOnly(), // TODO: fill this in

			materials: storage( new IndirectStorageBufferAttribute(), 'Material' ).toReadOnly(), // TODO: fill this in

			// compute variables
			globalId: globalId,
		};

		super( megakernelShader( megakernelShaderParams ) );

		this.defineUniformAccessors( megakernelShaderParams );

	}

}
