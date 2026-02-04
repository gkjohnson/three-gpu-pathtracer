import { ComputeKernel } from './ComputeKernel.js';
import { IndirectStorageBufferAttribute, StorageBufferAttribute, Matrix4, Vector2, TimestampQuery } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import megakernelShader from '../nodes/megakernel.wgsl.js';
import resetResultFn from '../nodes/reset.wgsl.js';
import {
	generateRays, traceRay, bsdfEval, escapedRay, cleanQueues,
	writeTraceRayDispatchSize, writeBsdfDispatchSize, writeEscapedRayDispatchSize,
} from '../nodes/wavefront.wgsl.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( bounces, options ) {

		const {
			geometry = null,
			dimensions = null,
			sampleCountBuffer = null,
			resultBuffer = null,
		} = options;

		const megakernelShaderParams = {
			resultBuffer: storage( resultBuffer, 'vec4' ),
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( dimensions ),
			sample_count_buffer: storage( sampleCountBuffer, 'u32' ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			geom_index: storage( geometry.index, 'uvec3' ).toReadOnly(),
			geom_position: storage( geometry.position, 'vec3' ).toReadOnly(),
			geom_normals: storage( geometry.normal, 'vec3' ).toReadOnly(),
			geom_material_index: storage( geometry.materialIndex, 'u32' ).toReadOnly(),
			bvh: storage( geometry.bvh, 'BVHNode' ).toReadOnly(),

			materials: storage( geometry.materials, 'Material' ).toReadOnly(),

			// compute variables
			globalId: globalId,
		};

		super( megakernelShader( bounces )( megakernelShaderParams ) );

	}

}
