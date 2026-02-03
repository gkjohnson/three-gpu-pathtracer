import { wgslFn } from 'three/tsl';
import { ndcToCameraRay, bvhIntersectFirstHit, constants as bvhConstants, getVertexAttribute, intersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { hitResultQueueElementStruct, rayQueueElementStruct, materialStruct, constants } from './structs.wgsl';
import { getSurfaceRecordFunc, lambertBsdfFunc, pbrtBsdfFunc } from './sampling.wgsl';
import { pcgInit, pcgCycleState } from './random.wgsl';

export const generateRays = wgslFn( /* wgsl */ `

	fn generateRays(
		cameraToModelMatrix: mat4x4f,
		inverseProjectionMatrix: mat4x4f,
		offset: vec2u,
		tileSize: vec2u,
		dimensions: vec2u,

		rayQueue: ptr<storage, array<u32>, read_write>,
		rayQueueSize: ptr<storage, array<atomic<u32>>, read_write>,

		globalId: vec3u
	) -> void {
		if (globalId.x >= tileSize.x || globalId.y >= tileSize.y) {
			return;
		}
		let indexUV = offset + globalId.xy;
		let uv = vec2f( indexUV ) / vec2f( dimensions );
		let ndc = uv * 2.0 - vec2f( 1.0 );

		let ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

		// TODO: Firstly write to workgroup-local memory, then put a bunch inside storage mem
		let index = atomicAdd(&rayQueueSize[0], 1);

		let elementCount = arrayLength(rayQueue) / RAY_ELEMENT_STRUCT_SIZE;

		rayQueueWriteOriginSoA(rayQueue, elementCount, index, ray.origin);
		rayQueueWriteDirectionSoA(rayQueue, elementCount, index, ray.direction);
		rayQueueWriteThroughputSoA(rayQueue, elementCount, index, vec3f(1.0));
		rayQueueWritePixelSoA(rayQueue, elementCount, index, indexUV);
		rayQueueWriteCurrentBounceSoA(rayQueue, elementCount, index, 0);
	}

`, [ rayQueueElementStruct, ndcToCameraRay ] );

export const bsdfEval = wgslFn( /* wgsl */ `
	fn bsdf(
		inputQueue: ptr<storage, array<HitResultQueueElement>, read>,
		outputQueue: ptr<storage, array<u32>, read_write>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

		geom_material_index: ptr<storage, array<u32>, read>,
		normals: ptr<storage, array<vec3f>, read>,
		materials: ptr<storage, array<Material>, read>,
		seed: u32,

		globalId: vec3u,
	) -> void {
		let inputSize = atomicLoad(&queueSizes[1]);
		if (globalId.x >= inputSize) {
			return;
		}

		let input = inputQueue[globalId.x];
		let pixel = vec2u(input.pixel_x, input.pixel_y);

		pcgInitialize(pixel, seed);
		pcgCycleState(input.currentBounce);

		var record: ScatterRecord;

		let material = materials[ geom_material_index[ input.indices.x ] ];

		let hit = IntersectionResult(
			true,
			vec4u( input.indices, 0 ),
			input.normal,
			input.barycoord,
			input.side,
			input.dist
		);
		let surf = getSurfaceRecord( material, hit, normals, normals );

		let scatterRec = bsdfSample( input.view, surf );

		if ( scatterRec.pdf <= 0 ) {

			return;

		}

		let throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;

		let rayIndex = atomicAdd(&queueSizes[0], 1);

		let elementCount = arrayLength(outputQueue) / RAY_ELEMENT_STRUCT_SIZE;

		rayQueueWriteOriginSoA(outputQueue, elementCount, rayIndex, input.position);
		rayQueueWriteDirectionSoA(outputQueue, elementCount, rayIndex, scatterRec.direction);
		rayQueueWritePixelSoA(outputQueue, elementCount, rayIndex, pixel);
		rayQueueWriteThroughputSoA(outputQueue, elementCount, rayIndex, throughputColor);
		rayQueueWriteCurrentBounceSoA(outputQueue, elementCount, rayIndex, input.currentBounce + 1);

		// outputQueue[rayIndex].ray.origin = input.position;
		// outputQueue[rayIndex].ray.direction = scatterRec.direction;
		// outputQueue[rayIndex].pixel = pixel;
		// outputQueue[rayIndex].throughputColor = throughputColor;
		// outputQueue[rayIndex].currentBounce = input.currentBounce + 1;

	}
`, [
	pbrtBsdfFunc,
	hitResultQueueElementStruct,
	rayQueueElementStruct,
	materialStruct,
	intersectionResultStruct,
	pcgInit,
	pcgCycleState,
	getSurfaceRecordFunc,
	constants
] );

export const traceRay = wgslFn( /* wgsl */`

	fn traceRay(
		inputQueue: ptr<storage, array<u32>, read>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
		escapedQueue: ptr<storage, array<u32>, read_write>,
		outputQueue: ptr<storage, array<HitResultQueueElement>, read_write>,

		geom_position: ptr<storage, array<vec3f>, read>,
		geom_index: ptr<storage, array<vec3u>, read>,
		geom_normals: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		globalId: vec3u,
	) -> void {
		let inputSize = atomicLoad(&queueSizes[0]);
		if (globalId.x >= inputSize) {
			return;
		}

		// let input = inputQueue[globalId.x];

		let elementCount = arrayLength(inputQueue) / RAY_ELEMENT_STRUCT_SIZE;

		let origin = rayQueueExtractOriginSoA(inputQueue, elementCount, globalId.x);
		let direction = rayQueueExtractDirectionSoA(inputQueue, elementCount, globalId.x);
		let ray = Ray(origin, direction);
		let pixel = rayQueueExtractPixelSoA(inputQueue, elementCount, globalId.x);
		let throughputColor = rayQueueExtractThroughputSoA(inputQueue, elementCount, globalId.x);
		let currentBounce = rayQueueExtractCurrentBounceSoA(inputQueue, elementCount, globalId.x);

		let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

		if ( hitResult.didHit ) {

			let index = atomicAdd(&queueSizes[1], 1);
			outputQueue[index].view = - ray.direction;
			outputQueue[index].normal = hitResult.normal; // getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );
			outputQueue[index].position = origin + direction * hitResult.dist; // getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
			outputQueue[index].indices = hitResult.indices.xyz;
			outputQueue[index].side = hitResult.side;
			outputQueue[index].barycoord = hitResult.barycoord;
			outputQueue[index].dist = hitResult.dist;

			outputQueue[index].pixel_x = pixel.x;
			outputQueue[index].pixel_y = pixel.y;

			outputQueue[index].throughputColor = throughputColor;

			outputQueue[index].currentBounce = currentBounce;
			// outputQueue[index].materialIndex = geom_material_index[hitResult.indices.x];

		} else {

			let index = atomicAdd(&queueSizes[2], 1);
			let escapedCount = arrayLength(escapedQueue) / RAY_ELEMENT_STRUCT_SIZE;
			// rayQueueWriteOriginSoA(escapedQueue, escapedCount, index, origin);
			// rayQueueWriteDirectionSoA(escapedQueue, escapedCount, index, direction);
			rayQueueWriteThroughputSoA(escapedQueue, escapedCount, index, throughputColor);
			rayQueueWritePixelSoA(escapedQueue, escapedCount, index, pixel);
			// rayQueueWriteCurrentBounceSoA(escapedQueue, escapedCount, index, currentBounce);

		}

	}

`, [
	hitResultQueueElementStruct,
	rayQueueElementStruct,
	getVertexAttribute,
	bvhIntersectFirstHit,
	bvhConstants
] );

// WARN: this kernel assumes only one ray per pixel at one time is possible
export const escapedRay = wgslFn( /* wgsl */`

	fn escapedRay(
		resultBuffer: ptr<storage, array<vec4f>, read_write>,
		inputQueue: ptr<storage, array<u32>, read>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
		sampleCountBuffer: ptr<storage, array<u32>, read_write>,

		dimensions: vec2u,
		globalId: vec3u,
	) -> void {
		let inputSize = atomicLoad(&queueSizes[2]);
		if (globalId.x >= inputSize) {
			return;
		}

		// let current = inputQueue[globalId.x];

		let escapedCount = arrayLength(inputQueue) / RAY_ELEMENT_STRUCT_SIZE;
		let throughputColor = rayQueueExtractThroughputSoA(inputQueue, escapedCount, globalId.x);
		let pixel = rayQueueExtractPixelSoA(inputQueue, escapedCount, globalId.x);

		let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );
		let resultColor = background * throughputColor;

		let offset = pixel.x + pixel.y * dimensions.x;

		const accumulate: bool = true;

		let prevColor = resultBuffer[offset];
		if ( accumulate ) {
			let prevSampleCount = sampleCountBuffer[offset];
			let newSampleCount = prevSampleCount + 1;
			sampleCountBuffer[offset] = newSampleCount;

			let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
			resultBuffer[offset] = vec4f( newColor, 1.0 );
		} else {
			resultBuffer[offset] = vec4f( resultColor, 1.0 );
		}
	}

`, [ rayQueueElementStruct ] );

export const writeTraceRayDispatchSize = wgslFn( /* wgsl */ `
	fn writeTraceRayDispatchSize(
		outputBuffer: ptr<storage, array<u32>, read_write>,

		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

		workgroupSize: u32,
	) -> void {
		atomicStore(&queueSizes[1], 0);
		atomicStore(&queueSizes[2], 0);

		let size = atomicLoad(&queueSizes[0]);
		outputBuffer[0] = u32( ceil( f32(size) / f32( workgroupSize ) ) );
		outputBuffer[1] = 1;
		outputBuffer[2] = 1;
	}

` );

export const writeEscapedRayDispatchSize = wgslFn( /* wgsl */ `
	fn writeTraceRayDispatchSize(
		outputBuffer: ptr<storage, array<u32>, read_write>,

		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
		workgroupSize: u32,
	) -> void {
		let size = atomicLoad(&queueSizes[2]);
		outputBuffer[0] = u32( ceil( f32(size) / f32( workgroupSize ) ) );
		outputBuffer[1] = 1;
		outputBuffer[2] = 1;
	}

` );

export const writeBsdfDispatchSize = wgslFn( /* wgsl */ `
	fn writeBsdfDispatchSize(
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
		outputBuffer: ptr<storage, array<u32>, read_write>,
		workgroupSize: u32
	) -> void {

		atomicStore(&queueSizes[0], 0);

		let count = atomicLoad(&queueSizes[1]);
		outputBuffer[0] = u32( ceil( f32(count) / f32( workgroupSize ) ) );
		outputBuffer[1] = 1;
		outputBuffer[2] = 1;
	}
`, );

export const cleanQueues = wgslFn( /* wgsl */`
	fn clean(
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
	) -> void {
		atomicStore(&queueSizes[0], 0);
		atomicStore(&queueSizes[1], 0);
		atomicStore(&queueSizes[2], 0);
	}
` );


