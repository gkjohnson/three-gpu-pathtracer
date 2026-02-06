import { wgslFn } from 'three/tsl';
import { ndcToCameraRay, bvhIntersectFirstHit, constants as bvhConstants, getVertexAttribute, intersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { hitResultQueueElementStruct, rayQueueElementStruct, materialStruct, constants, pathStateStruct, materialEvalRequestStruct } from './structs.wgsl';
import { getSurfaceRecordFunc, lambertBsdfFunc, pbrtBsdfFunc } from './sampling.wgsl';
import { pcgInit, pcgCycleState, pcgRand3 } from './random.wgsl';

export const initializeRandom = wgslFn( /* wgsl */ `

	fn initializeRandom(
		tileOffset: vec2u,
		tileSize: vec2u,
		pathState: ptr<storage, array<PathState>, read_write>,

		seed: u32,
		globalId: vec3u,
	) -> void {

		let indexUV = vec2u( pathIndex % tileSize.x, pathIndex / tileSize.x ) + tileOffset;
		pcgInitialize(pixel, seed);
		pathState[ globalId.x ].pcgState = g_state;

	}

`, [ pathStateStruct ] );

export const generateRays = wgslFn( /* wgsl */ `

	fn generateRays(
		cameraToModelMatrix: mat4x4f,
		inverseProjectionMatrix: mat4x4f,
		tileOffset: vec2u,
		tileSize: vec2u,
		dimensions: vec2u,

		pathState: ptr<storage, array<PathState>, read_write>,
		inputQueue: ptr<storage, array<u32>, read>,
		extensionRayQueue: ptr<storage, array<u32>, read_write>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

		seed: u32,

		globalId: vec3u
	) -> void {
		let queueSize = atomicLoad( &queueSizes[0] );
		if ( globalId.x >= queueSize ) {
			return;
		}

		let pathIndex = inputQueue[ globalId.x ];

		let indexUV = vec2u( pathIndex % tileSize.x, pathIndex / tileSize.x ) + tileOffset;

		let uv = vec2f( indexUV ) / vec2f( dimensions );

		let ndc = uv * 2.0 - vec2f( 1.0 );

		if ( all( pathState[ pathIndex ].pcgState.s0 == vec4u( 0 ) ) ) {
			pcgInitialize(indexUV, seed);
		} else {
			g_state = pathState[ pathIndex ].pcgState;
		}

		let ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

		// TODO: Firstly write to workgroup-local memory, then put a bunch inside storage mem
		// let index = atomicAdd( &rayQueueSize[0], 1 );

		pathState[ pathIndex ].ray = ray;
		pathState[ pathIndex ].throughputColor = vec3f( 1.0 );
		pathState[ pathIndex ].currentBounce = 0;
		pathState[ pathIndex ].color = vec3f( 1.0 );
		pathState[ pathIndex ].pdf = 1.0;
		pathState[ pathIndex ].pcgState = g_state;
		pathState[ pathIndex ].tileOffset = tileOffset;

		let index = atomicAdd( &queueSizes[2], 1 );

		extensionRayQueue[ index ] = pathIndex;

		// let elementCount = arrayLength(rayQueue) / RAY_ELEMENT_STRUCT_SIZE;

		// rayQueueWriteOriginSoA(rayQueue, elementCount, index, ray.origin);
		// rayQueueWriteDirectionSoA(rayQueue, elementCount, index, ray.direction);
		// rayQueueWriteThroughputSoA(rayQueue, elementCount, index, vec3f(1.0));
		// rayQueueWritePixelSoA(rayQueue, elementCount, index, indexUV);
		// rayQueueWriteCurrentBounceSoA(rayQueue, elementCount, index, 0);

		// rayQueue[index].ray = ray;
		// rayQueue[index].pixel = indexUV;
		// rayQueue[index].throughputColor = vec3f( 1.0 );
		// rayQueue[index].currentBounce = 0;
	}

`, [ rayQueueElementStruct, ndcToCameraRay, pathStateStruct, pcgInit ] );

export const bsdfEval = wgslFn( /* wgsl */ `
	fn bsdf(
		pathState: ptr<storage, array<PathState>, read_write>,
		inputQueue: ptr<storage, array<MaterialEvalRequest>, read>,
		extensionRayQueue: ptr<storage, array<u32>, read_write>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

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
		let pathIndex = input.pathIndex;

		g_state = pathState[ pathIndex ].pcgState;

		var record: ScatterRecord;

		let material = materials[ input.materialIndex ];

		let dist = pathState[ pathIndex ].dist;
		let hit = IntersectionResult(
			pathState[ pathIndex ].didHit == 1,
			vec4u( pathState[ pathIndex ].indices, 0 ),
			pathState[ pathIndex ].normal,
			pathState[ pathIndex ].barycoord,
			pathState[ pathIndex ].side,
			dist
		);
		let surf = getSurfaceRecord( material, hit, normals, normals );

		let direction = pathState[ pathIndex ].ray.direction;
		let scatterRec = bsdfSample( - direction, surf );

		pathState[ pathIndex ].color = scatterRec.color;
		pathState[ pathIndex ].pdf = scatterRec.pdf;
		pathState[ pathIndex ].pcgState = g_state;

		if ( scatterRec.pdf <= 0 ) {

			pathState[ pathIndex ].throughputColor = vec3f( 0.0 );
			return;

		}

		let origin = pathState[ pathIndex ].ray.origin;
		pathState[ pathIndex ].ray.origin = origin + dist * direction;
		pathState[ pathIndex ].ray.direction = scatterRec.direction;

		let index = atomicAdd( &queueSizes[2], 1 );
		extensionRayQueue[ index ] = pathIndex;

		// let throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
		//
		// let rayIndex = atomicAdd(&queueSizes[0], 1);
		//
		// let elementCount = arrayLength(outputQueue) / RAY_ELEMENT_STRUCT_SIZE;

		// rayQueueWriteOriginSoA(outputQueue, elementCount, rayIndex, input.position);
		// rayQueueWriteDirectionSoA(outputQueue, elementCount, rayIndex, scatterRec.direction);
		// rayQueueWritePixelSoA(outputQueue, elementCount, rayIndex, pixel);
		// rayQueueWriteThroughputSoA(outputQueue, elementCount, rayIndex, throughputColor);
		// rayQueueWriteCurrentBounceSoA(outputQueue, elementCount, rayIndex, input.currentBounce + 1);

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
	materialEvalRequestStruct,
	pathStateStruct,
	pcgInit,
	pcgCycleState,
	pcgRand3,
	getSurfaceRecordFunc,
	constants
] );

export const traceRay = wgslFn( /* wgsl */`

	fn traceRay(
		pathState: ptr<storage, array<PathState>, read_write>,
		inputQueue: ptr<storage, array<u32>, read>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

		geom_position: ptr<storage, array<vec3f>, read>,
		geom_index: ptr<storage, array<vec3u>, read>,
		geom_normals: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		globalId: vec3u,
	) -> void {
		let inputSize = atomicLoad( &queueSizes[2] );

		if (globalId.x >= inputSize) {
			return;
		}

		// let elementCount = arrayLength(inputQueue) / RAY_ELEMENT_STRUCT_SIZE;

		// let origin = rayQueueExtractOriginSoA(inputQueue, elementCount, globalId.x);
		// let direction = rayQueueExtractDirectionSoA(inputQueue, elementCount, globalId.x);
		// let ray = Ray(origin, direction);
		// let pixel = rayQueueExtractPixelSoA(inputQueue, elementCount, globalId.x);
		// let throughputColor = rayQueueExtractThroughputSoA(inputQueue, elementCount, globalId.x);
		// let currentBounce = rayQueueExtractCurrentBounceSoA(inputQueue, elementCount, globalId.x);

		let pathIndex = inputQueue[ globalId.x ];

		let ray = pathState[ pathIndex ].ray;

		let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

		pathState[ pathIndex ].indices = hitResult.indices.xyz;

		if ( hitResult.didHit ) {
			pathState[ pathIndex ].didHit = 1;
		} else {
			pathState[ pathIndex ].didHit = 0;
		}

		pathState[ pathIndex ].normal = hitResult.normal;
		pathState[ pathIndex ].side = hitResult.side;
		pathState[ pathIndex ].barycoord = hitResult.barycoord;
		pathState[ pathIndex ].dist = hitResult.dist;

		// if ( hitResult.didHit ) {
		//
		// 	let index = atomicAdd(&queueSizes[1], 1);
		// 	outputQueue[index].view = - ray.direction;
		// 	outputQueue[index].normal = hitResult.normal; // getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );
		// 	outputQueue[index].position = ray.origin + ray.direction * hitResult.dist; // getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
		// 	outputQueue[index].indices = hitResult.indices.xyz;
		// 	outputQueue[index].side = hitResult.side;
		// 	outputQueue[index].barycoord = hitResult.barycoord;
		// 	outputQueue[index].dist = hitResult.dist;
		//
		// 	outputQueue[index].pixel_x = pixel.x;
		// 	outputQueue[index].pixel_y = pixel.y;
		//
		// 	outputQueue[index].throughputColor = throughputColor;
		//
		// 	outputQueue[index].currentBounce = currentBounce;
		// 	// outputQueue[index].materialIndex = geom_material_index[hitResult.indices.x];
		//
		// } else {
		//
		// 	let index = atomicAdd(&queueSizes[2], 1);
		// 	let escapedCount = arrayLength(escapedQueue) / RAY_ELEMENT_STRUCT_SIZE;
		// 	// rayQueueWriteOriginSoA(escapedQueue, escapedCount, index, origin);
		// 	// rayQueueWriteDirectionSoA(escapedQueue, escapedCount, index, direction);
		// 	// rayQueueWriteThroughputSoA(escapedQueue, escapedCount, index, throughputColor);
		// 	// rayQueueWritePixelSoA(escapedQueue, escapedCount, index, pixel);
		// 	// rayQueueWriteCurrentBounceSoA(escapedQueue, escapedCount, index, currentBounce);
		//
		// 	escapedQueue[index].throughputColor = throughputColor;
		// 	escapedQueue[index].pixel = pixel;
		//
		// }

	}

`, [
	hitResultQueueElementStruct,
	rayQueueElementStruct,
	pathStateStruct,
	getVertexAttribute,
	bvhIntersectFirstHit,
	bvhConstants
] );

export const logic = wgslFn( /* wgsl */`

	fn logic(
		resultBuffer: ptr<storage, array<vec4f>, read_write>,
		sampleCountBuffer: ptr<storage, array<u32>, read_write>,

		pathState: ptr<storage, array<PathState>, read_write>,
		regeneratePathQueue: ptr<storage, array<u32>, read_write>,
		materialEvalQueue: ptr<storage, array<MaterialEvalRequest>, read_write>,
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

		geom_material_index: ptr<storage, array<u32>, read>,

		maxBounces: u32,
		tileOffset: vec2u,
		tileSize: vec2u,
		dimensions: vec2u,

		globalId: vec3u,
	) -> void {
		let pathIndex = globalId.x;
		let state = pathState[ pathIndex ];

		let throughputColor = pathState[ pathIndex ].throughputColor;

		let currentBounce = pathState[ pathIndex ].currentBounce;
		let isLastBounce = currentBounce >= maxBounces;

		let hasMissedScene = pathState[ pathIndex ].didHit == 0;

		let isThroughputEmpty = length( throughputColor ) < 1e-4; // all( newThroughput == vec3f( 0.0 ) );

		let isTerminated = isLastBounce || hasMissedScene || isThroughputEmpty;

		if ( !isTerminated ) {

			let newThroughput = throughputColor * pathState[ pathIndex ].color / pathState[ pathIndex ].pdf;
			pathState[ pathIndex ].throughputColor = newThroughput;
			pathState[ pathIndex ].currentBounce += 1;

			let materialIndex = geom_material_index[ pathState[ pathIndex ].indices.x ];

			let index = atomicAdd( &queueSizes[1], 1 );
			materialEvalQueue[ index ] = MaterialEvalRequest( pathIndex, materialIndex );

		} else if ( !isThroughputEmpty && !isLastBounce && hasMissedScene ) {

			// Add color contribution
			let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );

			let pathTileOffset = pathState[ pathIndex ].tileOffset;
			let pixel = vec2u( pathIndex % tileSize.x, pathIndex / tileSize.x ) + pathTileOffset;

			let newThroughput = throughputColor * pathState[ pathIndex ].color / pathState[ pathIndex ].pdf;

			let resultColor = background * newThroughput;

			let offset = pixel.x + pixel.y * dimensions.x;

			let prevColor = resultBuffer[offset];
			let prevSampleCount = sampleCountBuffer[offset];
			let newSampleCount = prevSampleCount + 1;
			sampleCountBuffer[offset] = newSampleCount;

			let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
			resultBuffer[offset] = vec4f( newColor, 1.0 );
			// resultBuffer[offset] = vec4f( resultColor, 1.0 );

		}

		if ( isTerminated ) {
			// Place in a queue for regeneration
			let index = atomicAdd( &queueSizes[0], 1 );
			regeneratePathQueue[ index ] = pathIndex;
		}
	}

`, [ rayQueueElementStruct, pathStateStruct, materialEvalRequestStruct ] );

export const writeTraceRayDispatchSize = wgslFn( /* wgsl */ `
	fn writeTraceRayDispatchSize(
		outputBuffer: ptr<storage, array<u32>, read_write>,

		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

		workgroupSize: u32,
	) -> void {
		// Empty material stage queues
		atomicStore(&queueSizes[0], 0);
		atomicStore(&queueSizes[1], 0);

		let size = atomicLoad(&queueSizes[2]);
		outputBuffer[0] = u32( ceil( f32(size) / f32( workgroupSize ) ) );
		outputBuffer[1] = 1;
		outputBuffer[2] = 1;
	}

` );

// export const writeLogicRayDispatchSize = wgslFn( /* wgsl */ `
// 	fn writeTraceRayDispatchSize(
// 		outputBuffer: ptr<storage, array<u32>, read_write>,
//
// 		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
// 		workgroupSize: u32,
// 	) -> void {
// 		let size = atomicLoad(&queueSizes[2]);
// 		outputBuffer[0] = u32( ceil( f32(size) / f32( workgroupSize ) ) );
// 		outputBuffer[1] = 1;
// 		outputBuffer[2] = 1;
// 	}
//
// ` );

export const writeMaterialStageDispatchSize = wgslFn( /* wgsl */ `
	fn writeBsdfDispatchSize(
		queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
		regenerateKernelBuffer: ptr<storage, array<u32>, read_write>,
		materialKernelBuffer: ptr<storage, array<u32>, read_write>,

		workgroupSize: u32
	) -> void {
		// Empty rayKernel input queue
		atomicStore( &queueSizes[2], 0 );

		let regenerateCount = atomicLoad( &queueSizes[0] );
		regenerateKernelBuffer[0] = u32( ceil( f32(regenerateCount) / f32( workgroupSize ) ) );
		regenerateKernelBuffer[1] = 1;
		regenerateKernelBuffer[2] = 1;

		let materialCount = atomicLoad(&queueSizes[1]);
		materialKernelBuffer[0] = u32( ceil( f32(materialCount) / f32( workgroupSize ) ) );
		materialKernelBuffer[1] = 1;
		materialKernelBuffer[2] = 1;
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


