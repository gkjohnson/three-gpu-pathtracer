import { wgslFn, storage, uniform, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel';
import { IndirectStorageBufferAttribute, StorageBufferAttribute, Vector2 } from 'three/webgpu';

export class ResetKernel extends ComputeKernel {

	constructor(
		resultBuffer = new StorageBufferAttribute(),
		sampleCountBuffer = new StorageBufferAttribute(),
	) {

		const params = {
			resultBuffer: storage( new StorageBufferAttribute(), 'vec4f' ),
			sampleCountBuffer: storage( new StorageBufferAttribute(), 'u32' ),
			dimensions: uniform( new Vector2() ),

			globalId: globalId,
		};

		const kernel = wgslFn( /* wgsl */`
			fn resetBuffers(
				resultBuffer: ptr<storage, array<vec4f>, read_write>,
				sampleCountBuffer: ptr<storage, array<u32>, read_write>,
				dimensions: vec2u,

				globalId: vec2u,
			) -> void {

				let offset = globalId.x + globalId.y * dimensions.x;
				sampleCountBuffer[offset] = 0;
				resultBuffer[offset] = vec4f(0.0, 0.0, 0.0, 1.0);

			}
		` )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
