import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel';
import { wgslFn, uniform, storage } from 'three/tsl';

export class MaterialStageDispatchKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			regenerateDispatchBuffer: storage( new IndirectStorageBufferAttribute(), 'uint' ),
			regenerateKernelWorkgroupSize: uniform( 1 ),

			materialDispatchBuffer: storage( new IndirectStorageBufferAttribute(), 'uint' ),
			materialKernelWorkgroupSize: uniform( 1 ),
			queueSizes: storage( new StorageBufferAttribute(), 'uint' ).toAtomic(),
		};

		const kernel = wgslFn( /* wgsl */`
			fn writeMaterialStageDispatchSize(
				regenerateDispatchBuffer: ptr<storage, array<u32>, read_write>,
				materialDispatchBuffer: ptr<storage, array<u32>, read_write>,

				regenerateKernelWorkgroupSize: u32,
				materialKernelWorkgroupSize: u32,

				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
			) -> void {
				// Empty extension ray queue
				atomicStore( &queueSizes[2], 0 );

				let regenerateCount = atomicLoad( &queueSizes[0] );
				regenerateDispatchBuffer[0] = u32( ceil( f32( regenerateCount ) / f32( regenerateKernelWorkgroupSize ) ) );
				regenerateDispatchBuffer[1] = 1;
				regenerateDispatchBuffer[2] = 1;

				let materialCount = atomicLoad(&queueSizes[1]);
				materialDispatchBuffer[0] = u32( ceil( f32( materialCount ) / f32( materialKernelWorkgroupSize ) ) );
				materialDispatchBuffer[1] = 1;
				materialDispatchBuffer[2] = 1;
			}
		` )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}

export class TraceRayDispatchKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			traceRayDispatchBuffer: storage( new IndirectStorageBufferAttribute(), 'uint' ),
			traceRayKernelWorkgroupSize: uniform( 1 ),
			queueSizes: storage( new StorageBufferAttribute(), 'uint' ).toAtomic(),
		};

		const kernel = wgslFn( /* wgsl */`
			fn writeTraceRayDispatchSize(
				traceRayDispatchBuffer: ptr<storage, array<u32>, read_write>,
				traceRayKernelWorkgroupSize: u32,

				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
			) -> void {
				// Empty material stage queues
				atomicStore(&queueSizes[0], 0);
				atomicStore(&queueSizes[1], 0);

				let size = atomicLoad(&queueSizes[2]);
				traceRayDispatchBuffer[0] = u32( ceil( f32(size) / f32( traceRayKernelWorkgroupSize ) ) );
				traceRayDispatchBuffer[1] = 1;
				traceRayDispatchBuffer[2] = 1;
			}
		` )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
