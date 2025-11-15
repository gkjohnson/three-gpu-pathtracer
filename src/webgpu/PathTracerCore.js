import { IndirectStorageBufferAttribute, StorageBufferAttribute, Matrix4, Vector2, StorageTexture } from 'three/webgpu';
import { bvhIntersectFirstHit, ndcToCameraRay, getVertexAttribute, constants, rayStruct } from 'three-mesh-bvh/webgpu';
import { storageTexture, wgsl, wgslFn, struct, textureStore, uniform, storage, globalId } from 'three/tsl';

const samplesEl = document.getElementById( 'samples' );

// TODO: replace with _renderer.compute when indirect dispatch is merged and available
function computeIndirect( renderer, computeNodes, buffer ) {

	if ( renderer._isDeviceLost === true ) return;

	if ( renderer._initialized === false ) {

		console.warn( 'THREE.Renderer: .compute() called before the backend is initialized. Try using .computeAsync() instead.' );
		return renderer.computeAsync( computeNodes );

	}

	//
	const nodeFrame = renderer._nodes.nodeFrame;
	const previousRenderId = nodeFrame.renderId;
	//
	renderer.info.calls ++;
	renderer.info.compute.calls ++;
	renderer.info.compute.frameCalls ++;
	nodeFrame.renderId = renderer.info.calls;
	//
	const backend = renderer.backend;
	const pipelines = renderer._pipelines;
	const bindings = renderer._bindings;
	const nodes = renderer._nodes;
	const computeList = Array.isArray( computeNodes ) ? computeNodes : [ computeNodes ];
	if ( computeList[ 0 ] === undefined || computeList[ 0 ].isComputeNode !== true ) {

		throw new Error( 'THREE.Renderer: .compute() expects a ComputeNode.' );

	}

	backend.beginCompute( computeNodes );
	for ( const computeNode of computeList ) {

		// onInit
		if ( pipelines.has( computeNode ) === false ) {

			const dispose = () => {

				computeNode.removeEventListener( 'dispose', dispose );
				pipelines.delete( computeNode );
				bindings.delete( computeNode );
				nodes.delete( computeNode );

			};

			computeNode.addEventListener( 'dispose', dispose );
			//
			const onInitFn = computeNode.onInitFunction;
			if ( onInitFn !== null ) {

				onInitFn.call( computeNode, { renderer: renderer } );

			}

		}

		nodes.updateForCompute( computeNode );
		bindings.updateForCompute( computeNode );
		const computeBindings = bindings.getForCompute( computeNode );
		const computePipeline = pipelines.getForCompute( computeNode, computeBindings );

		computeBackendIndirect( backend, computeNodes, computeNode, computeBindings, computePipeline, buffer );

	}

	backend.finishCompute( computeNodes );
	//
	nodeFrame.renderId = previousRenderId;

}

function computeBackendIndirect( backend, computeGroup, computeNode, bindings, pipeline, buffer ) {

	const { passEncoderGPU } = backend.get( computeGroup );

	// pipeline

	const pipelineGPU = backend.get( pipeline ).pipeline;

	backend.pipelineUtils.setPipeline( passEncoderGPU, pipelineGPU );

	// bind groups

	for ( let i = 0, l = bindings.length; i < l; i ++ ) {

		const bindGroup = bindings[ i ];
		const bindingsData = backend.get( bindGroup );

		passEncoderGPU.setBindGroup( i, bindingsData.group );

	}

	const dispatchBuffer = backend.get( buffer ).buffer;

	passEncoderGPU.dispatchWorkgroupsIndirect( dispatchBuffer, 0 );

}

function* renderTask() {

	while ( true ) {

		const { megakernel, _renderer, dimensions, WORKGROUP_SIZE, useMegakernel } = this;

		const startTime = window.performance.now();

		if ( useMegakernel ) {

			const dispatchSize = [
				Math.ceil( dimensions.x / WORKGROUP_SIZE[ 0 ] ),
				Math.ceil( dimensions.y / WORKGROUP_SIZE[ 1 ] ),
				1
			];

			_renderer.compute( megakernel, dispatchSize );

		} else {

			const dispatchSize = [
				Math.ceil( dimensions.x / WORKGROUP_SIZE[ 0 ] ),
				Math.ceil( dimensions.y / WORKGROUP_SIZE[ 1 ] ),
				1,
			];
			_renderer.compute( this.cleanQueuesKernel, 1 );
			_renderer.compute( this.generateRaysKernel, dispatchSize );

			for ( let i = 0; i < this.bounces; i ++ ) {

				// 1. Trace rays
				_renderer.compute( this.writeTraceRayDispatchSizeKernel, 1 );
				computeIndirect( _renderer, this.traceRayKernel, this.traceRayDispatchBuffer );

				// 2. Handle escaped and scattered rays
				_renderer.compute( this.writeEscapedRayDispatchSizeKernel, 1 );
				_renderer.compute( this.writeBsdfDispatchSizeKernel, 1 );
				computeIndirect( _renderer, this.escapedRayKernel, this.escapedRayDispatchBuffer );
				computeIndirect( _renderer, this.bsdfEvalKernel, this.bsdfDispatchBuffer );

			}

		}


		this.samples += 1;

		if ( _renderer.backend.device ) {

			// TODO: Get measuresments by three.js native things
			_renderer.backend.device.queue.onSubmittedWorkDone().then( () => {

				const endTime = window.performance.now();
				const delta = endTime - startTime;
				samplesEl.innerText = `Computing a sample took ${delta.toFixed( 2 )}ms, total ${this.samples} samples`;

			} );

		}

		yield;

	}

}

export class PathTracerCore {

	// get material() {

	// 	return this._fsQuad.material;

	// }

	// set material( v ) {

	// 	this._fsQuad.material.removeEventListener( 'recompilation', this._compileFunction );
	// 	v.addEventListener( 'recompilation', this._compileFunction );

	// 	this._fsQuad.material = v;

	// }

	// get target() {

	// 	return this._alpha ? this._blendTargets[ 1 ] : this._primaryTarget;

	// }

	// set alpha( v ) {

	// 	if ( this._alpha === v ) {

	// 		return;

	// 	}

	// 	if ( ! v ) {

	// 		this._blendTargets[ 0 ].dispose();
	// 		this._blendTargets[ 1 ].dispose();

	// 	}

	// 	this._alpha = v;
	// 	this.reset();

	// }

	// get alpha() {

	// 	return this._alpha;

	// }

	// get isCompiling() {

	// 	return Boolean( this._compilePromise );

	// }

	get megakernelParams() {

		return this.megakernel.computeNode.parameters;

	}

	get traceRayParams() {

		return this.traceRayKernel.computeNode.parameters;

	}

	get bsdfEvalParams() {

		return this.bsdfEvalKernel.computeNode.parameters;

	}

	get escapedRayParams() {

		return this.escapedRayKernel.computeNode.parameters;

	}

	get generateRaysParams() {

		return this.generateRaysKernel.computeNode.parameters;

	}

	constructor( renderer ) {

		this.camera = null;

		this.samples = 0;
		// this._subframe = new Vector4( 0, 0, 1, 1 );
		// this._opacityFactor = 1.0;
		this._renderer = renderer;
		// this._alpha = false;
		// this._fsQuad = new FullScreenQuad( new PhysicalPathTracingMaterial() );
		// this._blendQuad = new FullScreenQuad( new BlendMaterial() );
		this._task = null;
		// this._currentTile = 0;
		// this._compilePromise = null;

		// this._sobolTarget = new SobolNumberMapGenerator().generate( renderer );

		// this._primaryTarget = new WebGLRenderTarget( 1, 1, {
		// 	format: RGBAFormat,
		// 	type: FloatType,
		// 	magFilter: NearestFilter,
		// 	minFilter: NearestFilter,
		// } );
		// this._blendTargets = [
		// 	new WebGLRenderTarget( 1, 1, {
		// 		format: RGBAFormat,
		// 		type: FloatType,
		// 		magFilter: NearestFilter,
		// 		minFilter: NearestFilter,
		// 	} ),
		// 	new WebGLRenderTarget( 1, 1, {
		// 		format: RGBAFormat,
		// 		type: FloatType,
		// 		magFilter: NearestFilter,
		// 		minFilter: NearestFilter,
		// 	} ),
		// ];

		// function for listening to for triggered compilation so we can wait for compilation to finish
		// before starting to render
		// this._compileFunction = () => {

		// 	const promise = this.compileMaterial( this._fsQuad._mesh );
		// 	promise.then( () => {

		// 		if ( this._compilePromise === promise ) {

		// 			this._compilePromise = null;

		// 		}

		// 	} );

		// 	this._compilePromise = promise;

		// };

		// this.material.addEventListener( 'recompilation', this._compileFunction );

		this.bounces = 7;

		this.useMegakernel = true;

		this.geometry = {
			bvh: new StorageBufferAttribute(),
			index: new StorageBufferAttribute(),
			position: new StorageBufferAttribute(),
			normal: new StorageBufferAttribute(),

			materialIndex: new StorageBufferAttribute(),
			materials: new StorageBufferAttribute(),
		};

		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 ) );
		this.resultBuffer.name = 'Result Image #0';

		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( 1 ) );
		this.sampleCountBuffer.name = 'Sample Count';

		this.dimensions = new Vector2();

		// More resolution does not fit into webgpu-defualt 128mb buffer
		const maxRayCount = 1920 * 1080;
		const queueSize = /* element storage */ 16 * maxRayCount;
		this.rayQueue = new StorageBufferAttribute( new Uint32Array( queueSize ) );
		this.rayQueue.name = 'Ray Queue';

		// [rayQueueSize, hitResultQueueSize, escapedRayQueueSize]
		this.queueSizes = new StorageBufferAttribute( new Uint32Array( 3 ) );
		this.queueSizes.name = 'Queue Sizes';

		this.escapedQueue = new StorageBufferAttribute( new Uint32Array( 16 * maxRayCount ) );
		this.escapedQueue.name = 'Escaped Rays Queue';

		this.hitResultQueue = new StorageBufferAttribute( new Uint32Array( 16 * maxRayCount ) );
		this.hitResultQueue.name = 'Hit Result Queue';

		// TODO: find a way to bind an atomic-u32
		// Maybe create a TSL struct and try to use that? will it place it in storage?
		//
		// TODO: write a proposal for three.js
		//
		// const hitResultQueueStruct = wgsl( /* wgsl */ `
		// 	struct HitResultQueue {
		// 		queue: array<HitResultQueueElement>,
		// 		currentSize: atomic<u32>,
		// 	};
		// `, [ hitResultQueueElementStruct ] );

		this.WORKGROUP_SIZE = [ 8, 8, 1 ];
		this.bsdfEvalWorkgroupSize = [ 128, 1, 1 ];
		this.traceRayWorkgroupSize = [ 128, 1, 1 ];
		this.escapedRayWorkgroupSize = [ 128, 1, 1 ];

		const materialStruct = wgsl( /* wgsl */`
			struct Material {
				albedo: vec3f,
				// roughness: f32,
				// metalness: f32,
			};
		` );

		const surfaceRecordStruct = wgsl( /* wgsl */`
			struct SurfaceRecord {
				normal: vec3f,
				albedo: vec3f,

				roughness: f32,
				metalness: f32,
			};
		` );

		const pcgStateStruct = wgsl( /* wgsl */`
			struct PcgState {
				s0: vec4u,
				s1: vec4u,
				pixel: vec2i,
			};
		` );

		// const equirectDirectionToUvFn = wgslFn( /* wgsl */`
		// 	fn equirectDirectionToUv(direction: vec3f) -> vec2f {
		//
		// 		// from Spherical.setFromCartesianCoords
		// 		vec2 uv = vec2f( atan2( direction.z, direction.x ), acos( direction.y ) );
		// 		uv /= vec2f( 2.0 * PI, PI );
		//
		// 		// apply adjustments to get values in range [0, 1] and y right side up
		// 		uv.x += 0.5;
		// 		uv.y = 1.0 - uv.y;
		// 		return uv;
		//
		// 	}
		// ` );

		// const sampleEquirectColorFn = wgslFn( /* wgsl */ `
		// 	fn sampleEquirectColor( envMap: texture_2d<f32>, envMapSampler: sampler, direction: vec3f ) -> vec3f {

		// 		return texture2D( envMap, equirectDirectionToUv( direction ) ).rgb;

		// 	}
		// `, [ equirectDirectionToUvFn ] );

		const pcgInit = wgslFn( /* wgsl */`
			fn pcg_initialize(state: ptr<function, PcgState>, p: vec2u, frame: u32) -> void {
				state.pixel = vec2i( p );

				//white noise seed
				state.s0 = vec4u(p, frame, u32(p.x) + u32(p.y));

				//blue noise seed
				state.s1 = vec4u(frame, frame*15843, frame*31 + 4566, frame*2345 + 58585);
			}
		`, [ pcgStateStruct ] );

		const pcg4d = wgslFn( /* wgsl */ `
			fn pcg4d(v: ptr<function, vec4u>) -> void {
				*v = *v * 1664525u + 1013904223u;
				v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
				*v = *v ^ (*v >> vec4u(16u));
				v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
			}
		` );

		// TODO: test if abs there is necessary
		const pcgRand3 = wgslFn( /*wgsl*/`
			fn pcgRand3(state: ptr<function, PcgState>) -> vec3f {
				pcg4d(&state.s0);
				return abs( vec3f(state.s0.xyz) / f32(0xffffffffu) );
			}
		`, [ pcg4d, pcgStateStruct ] );

		const pcgRand2 = wgslFn( /*wgsl*/`
			fn pcgRand2(state: ptr<function, PcgState>) -> vec2f {
				pcg4d(&state.s0);
				return abs( vec2f(state.s0.xy) / f32(0xffffffffu) );
			}
		`, [ pcg4d, pcgStateStruct ] );

		// TODO: Move to a local (s, t, n) coordinate system
		// From RayTracingGems v1.9 chapter 16.6.2 -- Its shit!
		// https://www.realtimerendering.com/raytracinggems/unofficial_RayTracingGems_v1.9.pdf
		// result.xyz = cosine-wighted vector on the hemisphere oriented to a vector
		// result.w = pdf
		const sampleSphereCosineFn = wgslFn( /* wgsl */ `
			fn sampleSphereCosine(rng: vec2f, n: vec3f) -> vec4f {

				const PI: f32 = 3.141592653589793;
				let a = (1 - 2 * rng.x) * 0.99999;
				let b = sqrt( 1 - a * a ) * 0.99999;
				let phi = 2 * PI * rng.y;
				let direction = normalize( vec3f(n.x + b * cos( phi ), n.y + b * sin( phi ), n.z + a) );
				let pdf = dot( direction, n ) / PI;

				return vec4f( direction, pdf );
			}
		` );

		const scatterRecordStruct = wgsl( /* wgsl */ `
			struct ScatterRecord {
				direction: vec3f,
				pdf: f32, // Actually just a probability
				value: f32,
			};
		` );

		const lambertBsdfFunc = wgslFn( /* wgsl */`
			fn bsdfEval(rngState: ptr<function, PcgState>, normal: vec3f, view: vec3f) -> ScatterRecord {

				const PI: f32 = 3.141592653589793;
				var record: ScatterRecord;

				// Return bsdfValue / pdf, not bsdfValue and pdf separatly?
				let res = sampleSphereCosine( pcgRand2( rngState ), normal );
				record.direction = res.xyz;
				record.pdf = res.w;
				record.value = dot( record.direction, normal ) / PI;

				return record;

			}
		`, [ scatterRecordStruct, sampleSphereCosineFn, pcgRand2 ] );

		this.megakernelComputeShader = wgslFn( /* wgsl */`

			fn compute(
				resultBuffer: ptr<storage, array<vec4f>, read_write>,
				dimensions: vec2u,
				smoothNormals: u32,
				inverseProjectionMatrix: mat4x4f,
				cameraToModelMatrix: mat4x4f,
				seed: u32,
				sample_count_buffer: ptr<storage, array<u32>, read_write>,

				geom_position: ptr<storage, array<vec3f>, read>,
				geom_index: ptr<storage, array<vec3u>, read>,
				geom_normals: ptr<storage, array<vec3f>, read>,
				geom_material_index: ptr<storage, array<u32>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,

				materials: ptr<storage, array<Material>, read>,

				globalId: vec3u,
			) -> void {

				// to screen coordinates
				let indexUV = globalId.xy;
				let uv = vec2f( indexUV ) / vec2f( dimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				var rngState: PcgState;
				pcg_initialize(&rngState, indexUV, seed);

				// scene ray
				// TODO: sample a random ray
				var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

				const bounces: u32 = ${this.bounces};
				var resultColor = vec3f( 0.0 );
				var throughputColor = vec3f( 1.0 );
				var sampleCount = 0u;
				// TODO: fix shadow acne? RTIOW says we could just ignore ray hits that are too close
				for (var bounce = 0u; bounce < bounces; bounce++) {
					let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

					// write result
					if ( hitResult.didHit ) {

						let material = materials[ geom_material_index[ hitResult.indices.x ] ];
						// var surfaceRecord: SurfaceRecord;
						// surfaceRecord.normal = hitResult.normal;
						// surfaceRecord.albedo = material.albedo;
						// surfaceRecord.roughness = material.roughness;
						// surfaceRecord.metalness = material.metalness;

						let hitPosition = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
						let hitNormal = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );

						let scatterRec = bsdfEval(&rngState, hitNormal, - ray.direction);
						// let scatterRec = bsdfEval(&rngState, hitResult.normal, - ray.direction);
						// TODO: fix shadow acne
						// if (bounce == 1) {
						// 	resultColor = vec3f( 0.0, 1.0, 0.0 ); //  dot( scatterRec.direction, hitNormal ) ); // ( vec3f( 1.0 ) + scatterRec.direction ) * 0.5;
						// 	sampleCount = 1;
						// 	break;
						// }

						throughputColor *= material.albedo * scatterRec.value / scatterRec.pdf;

						ray.origin = hitPosition;
						ray.direction = scatterRec.direction;

					} else {

						let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );
						resultColor += background * throughputColor;
						sampleCount += 1;
						break;
					}

				}

				if ( sampleCount == 0 ) {
					return;
				}

				const accumulate: bool = true;

				let offset = globalId.x + globalId.y * dimensions.x;
				let prevSampleCount = sample_count_buffer[offset];
				let newSampleCount = prevSampleCount + sampleCount;
				sample_count_buffer[offset] = newSampleCount;

				let prevColor = resultBuffer[offset];
				if ( accumulate ) {
					let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
					resultBuffer[offset] = vec4f( newColor, 1.0 );
				} else {
					resultBuffer[offset] = vec4f( resultColor.xyz / f32( sampleCount ), 1.0 );
				}

			}
		`, [ ndcToCameraRay, bvhIntersectFirstHit, constants, getVertexAttribute, materialStruct, surfaceRecordStruct, pcgRand3, pcgInit, lambertBsdfFunc ] );
		this.createMegakernel();

		this.resetComputeShader = wgslFn( /* wgsl */ `

			fn reset(
				resultBuffer: ptr<storage, array<vec4f>, read_write>,
				sample_count_buffer: ptr<storage, array<u32>, read_write>,
				dimensions: vec2u,

				globalId: vec2u,
			) -> void {

				let offset = globalId.x + globalId.y * dimensions.x;
				sample_count_buffer[offset] = 0;
				resultBuffer[offset] = vec4f(0.0);

			}

		` );

		this.createResetKernel();

		const rayQueueElementStruct = wgsl( /* wgsl */ `

			struct RayQueueElement {
				ray: Ray,
				throughputColor: vec3f,
				pixel: vec2u,
			};

		`, [ rayStruct ] );

		const rayQueueStruct = wgsl( /* wgsl */ `

			struct RayQueue {
				currentSize: atomic<u32>,
				queue: array<RayQueueElement>,
			};

		`, [ rayQueueElementStruct ] );

		const generateRaysParams = {

			cameraToModelMatrix: uniform( new Matrix4() ),
			inverseProjectionMatrix: uniform( new Matrix4() ),
			dimensions: uniform( this.dimensions ),

			rayQueue: storage( this.rayQueue, 'RayQueueElement' ),
			rayQueueSize: storage( this.queueSizes, 'uint' ).toAtomic(),

			globalId: globalId,

		};

		const generateRays = wgslFn( /* wgsl */ `

			fn generateRays(
				cameraToModelMatrix: mat4x4f,
				inverseProjectionMatrix: mat4x4f,
				dimensions: vec2u,

				rayQueue: ptr<storage, array<RayQueueElement>, read_write>,
				rayQueueSize: ptr<storage, array<atomic<u32>>, read_write>,

				globalId: vec3u
			) -> void {
				if (globalId.x >= dimensions.x || globalId.y >= dimensions.y) {
					return;
				}
				let indexUV = globalId.xy;
				let uv = vec2f( indexUV ) / vec2f( dimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				let ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

				// TODO: Firstly write to workgroup-local memory, then put a bunch inside storage mem
				let index = atomicAdd(&rayQueueSize[0], 1);

				rayQueue[index].ray = ray;
				rayQueue[index].pixel = indexUV;
				rayQueue[index].throughputColor = vec3f(1.0);
			}

		`, [ rayQueueElementStruct, ndcToCameraRay ] );

		this.generateRaysKernel = generateRays( generateRaysParams ).computeKernel( this.WORKGROUP_SIZE );

		const hitResultQueueElementStruct = wgsl( /* wgsl */`
			struct HitResultQueueElement {
				normal: vec3f,
				pixel_x: u32,
				position: vec3f,
				pixel_y: u32,
				view: vec3f,
				throughputColor: vec3f,
				vertexIndex: u32,
			};
		` );

		this.traceRay = wgslFn( /* wgsl */`

			fn traceRay(
				inputQueue: ptr<storage, array<RayQueueElement>, read>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
				escapedQueue: ptr<storage, array<RayQueueElement>, read_write>,
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

				let input = inputQueue[globalId.x];

				let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, input.ray );

				if ( hitResult.didHit ) {

					let index = atomicAdd(&queueSizes[1], 1);
					outputQueue[index].view = - input.ray.direction;
					outputQueue[index].normal = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );
					outputQueue[index].position = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
					outputQueue[index].pixel_x = input.pixel.x;
					outputQueue[index].pixel_y = input.pixel.y;
					outputQueue[index].vertexIndex = hitResult.indices.x;
					outputQueue[index].throughputColor = input.throughputColor;
					// outputQueue[index].materialIndex = geom_material_index[hitResult.indices.x];

				} else {

					let index = atomicAdd(&queueSizes[2], 1);
					escapedQueue[index] = input;

				}

			}

		`, [ hitResultQueueElementStruct, rayQueueStruct, getVertexAttribute, bvhIntersectFirstHit ] );
		this.createTraceRayKernel();

		// WARN: this kernel assumes only one ray per pixel at one time is possible
		this.escapedRay = wgslFn( /* wgsl */`

			fn escapedRay(
				resultBuffer: ptr<storage, array<vec4f>, read_write>,
				inputQueue: ptr<storage, array<RayQueueElement>, read>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
				sampleCountBuffer: ptr<storage, array<u32>, read_write>,

				dimensions: vec2u,
				globalId: vec3u,
			) -> void {
				let inputSize = atomicLoad(&queueSizes[2]);
				if (globalId.x >= inputSize) {
					return;
				}

				let current = inputQueue[globalId.x];

				let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );
				let resultColor = background * current.throughputColor;

				let offset = current.pixel.x + current.pixel.y * dimensions.x;

				const accumulate: bool = true;

				let prevSampleCount = sampleCountBuffer[offset];
				let newSampleCount = prevSampleCount + 1;
				sampleCountBuffer[offset] = newSampleCount;

				let prevColor = resultBuffer[offset];
				if ( accumulate ) {
					let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
					resultBuffer[offset] = vec4f( newColor, 1.0 );
				} else {
					resultBuffer[offset] = vec4f( resultColor, 1.0 );
				}
			}

		`, [ rayQueueElementStruct ] );

		this.createEscapedRayKernel();

		// TODO: Make seed unique per-pixel, not per-frame for proper randomisation
		// TODO: collect results in workgroup-local mem first, then move to storage
		this.bsdfEval = wgslFn( /* wgsl */ `
			fn bsdf(
				inputQueue: ptr<storage, array<HitResultQueueElement>, read>,
				outputQueue: ptr<storage, array<RayQueueElement>, read_write>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

				geom_material_index: ptr<storage, array<u32>, read>,
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

				var rngState: PcgState;
				pcg_initialize(&rngState, pixel, seed);

				const PI: f32 = 3.141592653589793;
				var record: ScatterRecord;

				let material = materials[ geom_material_index[ input.vertexIndex ] ];

				let scatterRec = bsdfEval(&rngState, input.normal, input.view);

				let throughputColor = input.throughputColor * material.albedo * scatterRec.value / scatterRec.pdf;

				let rayIndex = atomicAdd(&queueSizes[0], 1);
				outputQueue[rayIndex].ray.origin = input.position;
				outputQueue[rayIndex].ray.direction = scatterRec.direction;
				outputQueue[rayIndex].pixel = pixel;
				outputQueue[rayIndex].throughputColor = throughputColor;

			}
		`, [ lambertBsdfFunc, hitResultQueueElementStruct, rayQueueElementStruct, materialStruct, pcgInit ] );
		this.createBsdfEvalKernel();

		this.traceRayDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.traceRayDispatchBuffer.name = 'Dispatch Buffer for Trace Ray';
		const writeTraceRayDispatchSizeParams = {
			outputBuffer: storage( this.traceRayDispatchBuffer, 'uint' ),

			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			workgroupSize: uniform( this.traceRayWorkgroupSize[ 0 ] ),
		};

		const writeTraceRayDispatchSize = wgslFn( /* wgsl */ `
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

		this.writeTraceRayDispatchSizeKernel = writeTraceRayDispatchSize( writeTraceRayDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		this.escapedRayDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.escapedRayDispatchBuffer.name = 'Dispatch Buffer for Escaped Rays';

		const writeEscapedRayDispatchSizeParams = {
			outputBuffer: storage( this.escapedRayDispatchBuffer, 'uint' ),

			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			workgroupSize: uniform( this.escapedRayWorkgroupSize[ 0 ] ),
		};

		const writeEscapedRayDispatchSize = wgslFn( /* wgsl */ `
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

		this.writeEscapedRayDispatchSizeKernel = writeEscapedRayDispatchSize( writeEscapedRayDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		this.bsdfDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.bsdfDispatchBuffer.name = 'Dispatch Buffer for bsdf eval';
		const writeBsdfDispatchSizeParams = {
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			outputBuffer: storage( this.bsdfDispatchBuffer, 'uint' ),

			workgroupSize: uniform( this.bsdfEvalWorkgroupSize[ 0 ] ),
		};

		const writeBsdfDispatchSize = wgslFn( /* wgsl */ `
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

		this.writeBsdfDispatchSizeKernel = writeBsdfDispatchSize( writeBsdfDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		const cleanQueuesParams = {
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
		};

		const cleanQueues = wgslFn( /* wgsl */`
			fn clean(
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
			) -> void {
				atomicStore(&queueSizes[0], 0);
				atomicStore(&queueSizes[1], 0);
				atomicStore(&queueSizes[2], 0);
			}
		` );

		this.cleanQueuesKernel = cleanQueues( cleanQueuesParams ).computeKernel( [ 1, 1, 1 ] );

	}

	createMegakernel() {

		const megakernelShaderParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4' ),
			dimensions: uniform( new Vector2() ),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			geom_index: storage( this.geometry.index, 'uvec3' ).toReadOnly(),
			geom_position: storage( this.geometry.position, 'vec3' ).toReadOnly(),
			geom_normals: storage( this.geometry.normal, 'vec3' ).toReadOnly(),
			geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),
			bvh: storage( this.geometry.bvh, 'BVHNode' ).toReadOnly(),

			materials: storage( this.geometry.materials, 'Material' ).toReadOnly(),

			// compute variables
			globalId: globalId,
		};

		this.megakernel = this.megakernelComputeShader( megakernelShaderParams ).computeKernel( this.WORKGROUP_SIZE );

	}

	createResetKernel() {

		const resetParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4f' ),
			dimensions: uniform( this.dimensions ),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),

			globalId: globalId,
		};


		this.resetKernel = this.resetComputeShader( resetParams ).computeKernel( this.WORKGROUP_SIZE );

	}

	createEscapedRayKernel() {

		const escapedRayParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4' ),
			inputQueue: storage( this.escapedQueue, 'RayQueueElement' ).toReadOnly(),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			sampleCountBuffer: storage( this.sampleCountBuffer, 'u32' ),

			dimensions: uniform( this.dimensions ),
			globalId: globalId,
		};

		this.escapedRayKernel = this.escapedRay( escapedRayParams ).computeKernel( this.escapedRayWorkgroupSize );

	}

	createTraceRayKernel() {

		const traceRayParams = {
			inputQueue: storage( this.rayQueue, 'RayQueueElement' ).toReadOnly(),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			escapedQueue: storage( this.escapedQueue, 'RayQueueElement' ),
			outputQueue: storage( this.hitResultQueue, 'HitResultQueueElement' ),

			geom_index: storage( this.geometry.index, 'uvec3' ).toReadOnly(),
			geom_position: storage( this.geometry.position, 'vec3' ).toReadOnly(),
			geom_normals: storage( this.geometry.normal, 'vec3' ).toReadOnly(),
			// geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),
			bvh: storage( this.geometry.bvh, 'BVHNode' ).toReadOnly(),

			globalId: globalId,
		};

		this.traceRayKernel = this.traceRay( traceRayParams ).computeKernel( this.traceRayWorkgroupSize );

	}

	createBsdfEvalKernel() {

		const bsdfEvalParams = {
			inputQueue: storage( this.hitResultQueue, 'HitResultQueueElement' ).toReadOnly(),
			outputQueue: storage( this.rayQueue, 'RayQueueElement' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),
			materials: storage( this.geometry.materials, 'Material' ).toReadOnly(),
			seed: uniform( 0 ),

			globalId: globalId,
		};

		this.bsdfEvalKernel = this.bsdfEval( bsdfEvalParams ).computeKernel( this.bsdfEvalWorkgroupSize );

	}

	setUseMegakernel( value ) {

		this.useMegakernel = value;
		this.reset();

	}

	setGeometryData( geometry ) {

		for ( const propName in geometry ) {

			const prop = this.geometry[ propName ];
			if ( prop === undefined ) {

				console.error( `Invalid property name in geometry data: ${propName}` );
				continue;

			}

			try {

				this._renderer.destroyAttribute( prop );

			} catch ( e ) {

				console.error( 'Failed to destroy geometry attribute. Pbbly because it did not have a gpu buffer' );

			}

			this.geometry[ propName ] = geometry[ propName ];

		}

		this.createMegakernel();
		this.createBsdfEvalKernel();
		this.createTraceRayKernel();

	}

	// compileMaterial() {

	// 	return this._renderer.compileAsync( this._fsQuad._mesh );

	// }

	setCamera( camera ) {

		this.camera = camera;

	}

	setSize( w, h ) {

		w = 1920;
		h = 1080;

		w = Math.ceil( w );
		h = Math.ceil( h );

		if ( this.dimensions.x === w && this.dimensions.y === h ) {

			return;

		}

		this.bufferCount = ( this.bufferCount ?? 0 ) + 1;
		this.dimensions.set( w, h );

		try {

			this._renderer.destroyAttribute( this.resultBuffer );
			this._renderer.destroyAttribute( this.sampleCountBuffer );

		} catch ( e ) {

			console.log( 'Failed to destroy result buffer. Pbbly there was no gpu buffer for it' );

		}

		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 * w * h ) );
		this.resultBuffer.name = `Result Image #${this.bufferCount}`;
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( w * h ) );
		this.sampleCountBuffer.name = 'Sample Counts';

		this.createResetKernel();
		this.createEscapedRayKernel();
		this.createMegakernel();

		// this._blendTargets[ 0 ].setSize( w, h );
		// this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	getSize( target ) {

		target.copy( this.dimensions );

	}

	dispose() {

		// TODO: dispose of all buffers

		// this._fsQuad.dispose();
		// this._blendQuad.dispose();
		this._task = null;

	}

	reset() {

		const { _renderer } = this;

		const dispatchSize = [
			Math.ceil( this.dimensions.x / this.WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( this.dimensions.y / this.WORKGROUP_SIZE[ 1 ] ),
			1
		];

		_renderer.compute( this.resetKernel, dispatchSize );

		this.megakernelParams.seed.value = 0;
		this.bsdfEvalParams.seed.value = 0;

		this.samples = 0;
		this._task = null;

	}

	update() {

		// ensure we've updated our defines before rendering so we can ensure we
		// can wait for compilation to finish
		// this.material.onBeforeRender();

		// if ( this.isCompiling ) {

		// 	return;

		// }
		if ( ! this.camera ) {

			return;

		}

		this.megakernelParams.seed.value += 1;
		this.megakernelParams.dimensions.value.copy( this.dimensions );
		this.megakernelParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.megakernelParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		this.bsdfEvalParams.seed.value += 1;
		this.escapedRayParams.dimensions.value.copy( this.dimensions );
		this.generateRaysParams.dimensions.value.copy( this.dimensions );
		this.generateRaysParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.generateRaysParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

	getResultBuffer() {

		return this.resultBuffer;

	}

}
