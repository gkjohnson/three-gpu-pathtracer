import { StorageBufferAttribute, Matrix4, Vector2, StorageTexture } from 'three/webgpu';
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

	constructor( renderer ) {

		this.WORKGROUP_SIZE = [ 8, 8, 1 ];

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

		const equirectDirectionToUvFn = wgslFn( /* wgsl */`
			fn equirectDirectionToUv(direction: vec3f) -> vec2f {

				// from Spherical.setFromCartesianCoords
				vec2 uv = vec2f( atan2( direction.z, direction.x ), acos( direction.y ) );
				uv /= vec2f( 2.0 * PI, PI );

				// apply adjustments to get values in range [0, 1] and y right side up
				uv.x += 0.5;
				uv.y = 1.0 - uv.y;
				return uv;

			}
		` );

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

		// this.resultTextures = [ new StorageTexture(), new StorageTexture() ];
		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 ) );
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( 1 ) );
		this.dimensions = new Vector2();

		const megakernelShaderParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4' ), // storageTexture( this.resultTextures[ 0 ] ).toReadOnly(),
			// outputTex: storageTexture( this.resultTextures[ 1 ] ).toWriteOnly(),
			dimensions: uniform( new Vector2() ),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			geom_index: storage( new StorageBufferAttribute( 0, 3 ), 'uvec3' ).toReadOnly(),
			geom_position: storage( new StorageBufferAttribute( 0, 3 ), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute( 0, 3 ), 'vec3' ).toReadOnly(),
			geom_material_index: storage( new StorageBufferAttribute( 0, 1 ), 'u32' ).toReadOnly(),
			bvh: storage( new StorageBufferAttribute( 0, 8 ), 'BVHNode' ).toReadOnly(),

			materials: storage( new StorageBufferAttribute( 0, 3 ), 'Material' ).toReadOnly(),

			// compute variables
			globalId: globalId,
		};

		const megakernelComputeShader = wgslFn( /* wgsl */`

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

		this.megakernel = megakernelComputeShader( megakernelShaderParams ).computeKernel( this.WORKGROUP_SIZE );

		const resetParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4f' ),
			dimensions: uniform( new Vector2() ),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),

			globalId: globalId,
		};

		const resetComputeShader = wgslFn( /* wgsl */ `

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

		this.resetKernel = resetComputeShader( resetParams ).computeKernel( this.WORKGROUP_SIZE );

		// const QueueSize = struct( { currentSize: { type: 'uint', atomic: true } }, 'QueueSize' );

		const maxRayCount = 1920 * 1080;
		const queueSize = /* element storage */ 14 * maxRayCount;
		const rayQueue = new StorageBufferAttribute( new Uint32Array( queueSize ) );
		// [rayQueueSize, escapedQueueSize, hitResultQueueSize]
		const queueSizes = new StorageBufferAttribute( new Uint32Array( 3 ) );

		const rayQueueElementStruct = wgsl( /* wgsl */ `

			struct RayQueueElement {
				ray: Ray,
				pixel: vec2u,
				throughputColor: vec3f,
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
			dimensions: uniform( new Vector2() ),

			rayQueue: storage( rayQueue, 'RayQueueElement' ),
			rayQueueSize: storage( queueSizes, 'uint' ).toAtomic(),

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
				let indexUV = globalId.xy;
				let uv = vec2f( indexUV ) / vec2f( dimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				let ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

				// TODO: Firtly write to workgroup-local memory, then put a bunch inside storage mem
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
				position: vec3f,
				vertexIndex: u32,
				view: vec3f,
				throughputColor: vec3f,
				pixel: vec2u,
			};
		` );

		// TODO: find a way to bind an atomic-u32
		// Maybe create a TSL struct and try to use that? will it place it in storage?
		//
		// const hitResultQueueStruct = wgsl( /* wgsl */ `
		// 	struct HitResultQueue {
		// 		queue: array<HitResultQueueElement>,
		// 		currentSize: atomic<u32>,
		// 	};
		// `, [ hitResultQueueElementStruct ] );

		const escapedQueue = new StorageBufferAttribute( new Uint32Array( 14 * maxRayCount ) );

		const hitResultQueue = new StorageBufferAttribute( new Uint32Array( 18 * maxRayCount ) );

		const traceRayParams = {
			inputQueue: storage( rayQueue, 'RayQueueElement' ).toReadOnly(),
			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),
			escapedQueue: storage( escapedQueue, 'RayQueueElement' ),
			outputQueue: storage( hitResultQueue, 'HitResultQueueElement' ),

			geom_index: storage( new StorageBufferAttribute( 0, 3 ), 'uvec3' ).toReadOnly(),
			geom_position: storage( new StorageBufferAttribute( 0, 3 ), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute( 0, 3 ), 'vec3' ).toReadOnly(),
			// geom_material_index: storage( new StorageBufferAttribute( 0, 1 ), 'u32' ).toReadOnly(),
			bvh: storage( new StorageBufferAttribute( 0, 8 ), 'BVHNode' ).toReadOnly(),

			globalId: globalId,
		};

		const traceRay = wgslFn( /* wgsl */`

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
					outputQueue[index].pixel = input.pixel;
					outputQueue[index].vertexIndex = hitResult.indices.x;
					// outputQueue[index].materialIndex = geom_material_index[hitResult.indices.x];

				} else {

					let index = atomicAdd(&queueSizes[2], 1);
					escapedQueue[index] = input;

				}

			}

		`, [ hitResultQueueElementStruct, rayQueueStruct, getVertexAttribute, bvhIntersectFirstHit ] );

		this.traceRayWorkgroupSize = [ 16, 1, 1 ];
		this.traceRayKernel = traceRay( traceRayParams ).computeKernel( this.traceRayWorkgroupSize );

		const escapedRayParams = {
			resultBuffer: storage( new StorageBufferAttribute(), 'vec4' ),
			inputQueue: storage( escapedQueue, 'RayQueueElement' ).toReadOnly(),
			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),
			sampleCountBuffer: storage( this.sampleCountBuffer, 'u32' ),

			dimensions: uniform( new Vector2() ),
			globalId: globalId,
		};

		// WARN: this kernel assumes only one ray per pixel at one time is possible
		const escapedRay = wgslFn( /* wgsl */`

			fn escapedRay(
				resultBuffer: ptr<storage, array<vec4f>, read_write>,
				inputQueue: ptr<storage, array<RayQueueElement>, read>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
				sampleCountBuffer: ptr<storage, array<u32>, read_write>,

				dimensions: vec2u,
				globalId: vec3u,
			) -> void {
				let inputSize = atomicLoad(&queueSizes[1]);
				if (globalId.x >= inputSize) {
					return;
				}

				let current = inputQueue[globalId.x];

				let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );
				let resultColor = background * current.throughputColor;

				let offset = current.pixel.x + current.pixel.y * dimensions.y;

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

		this.escapedRayWorkgroupSize = [ 16, 1, 1 ];
		this.escapedRayKernel = escapedRay( escapedRayParams ).computeKernel( this.escapedRayWorkgroupSize );

		const bsdfEvalParams = {
			inputQueue: storage( hitResultQueue, 'HitResultQueueElement' ).toReadOnly(),
			outputQueue: storage( rayQueue, 'RayQueueElement' ),
			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),

			geom_material_index: storage( new StorageBufferAttribute( 0, 1 ), 'u32' ).toReadOnly(),
			materials: storage( new StorageBufferAttribute( 0, 3 ), 'Material' ).toReadOnly(),
			seed: uniform( 0 ),

			globalId: globalId,
		};

		// TODO: Make seed unique per-pixel, not per-frame for proper randomisation
		// TODO: collect results in workgroup-local mem first, then move to storage
		const bsdfEval = wgslFn( /* wgsl */ `
			fn bsdf(
				inputQueue: ptr<storage, array<HitResultQueueElement>, read>,
				outputQueue: ptr<storage, array<RayQueueElement>, read_write>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

				geom_material_index: ptr<storage, array<u32>, read>,
				materials: ptr<storage, array<Material>, read>,
				seed: u32,

				globalId: vec3u,
			) -> void {
				let inputSize = atomicLoad(&queueSizes[2]);
				if (globalId.x >= inputSize) {
					return;
				}

				let input = inputQueue[globalId.x];

				var rngState: PcgState;
				pcg_initialize(&rngState, input.pixel, seed);

				const PI: f32 = 3.141592653589793;
				var record: ScatterRecord;

				let material = materials[ geom_material_index[ input.vertexIndex ] ];

				let scatterRec = bsdfEval(&rngState, input.normal, input.view);

				let throughputColor = input.throughputColor * material.albedo * scatterRec.value / scatterRec.pdf;

				let rayIndex = atomicAdd(&queueSizes[0], 1);
				outputQueue[rayIndex].ray.origin = input.position;
				outputQueue[rayIndex].ray.direction = scatterRec.direction;
				outputQueue[rayIndex].pixel = input.pixel;

			}
		`, [ lambertBsdfFunc, hitResultQueueElementStruct, rayQueueElementStruct, materialStruct, pcgInit ] );

		this.bsdfEvalWorkgroupSize = [ 16, 1, 1 ];
		this.bsdfEvalKernel = bsdfEval( bsdfEvalParams ).computeKernel( this.bsdfEvalWorkgroupSize );

		this.traceRayDispatchBuffer = new StorageBufferAttribute( new Uint32Array( 3 ) );
		const writeTraceRayDispatchSizeParams = {
			outputBuffer: storage( this.traceRayDispatchBuffer, 'uint' ),

			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),

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

		this.escapedRayDispatchBuffer = new StorageBufferAttribute( new Uint32Array( 3 ) );

		const writeEscapedRayDispatchSizeParams = {
			outputBuffer: storage( this.escapedRayDispatchBuffer, 'uint' ),

			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),

			workgroupSize: uniform( this.escapedRayWorkgroupSize[ 0 ] ),
		};

		const writeEscapedRayDispatchSize = wgslFn( /* wgsl */ `
			fn writeTraceRayDispatchSize(
				outputBuffer: ptr<storage, array<u32>, read_write>,

				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,
				workgroupSize: u32,
			) -> void {
				let size = atomicLoad(&queueSizes[1]);
				outputBuffer[0] = u32( ceil( f32(size) / f32( workgroupSize ) ) );
				outputBuffer[1] = 1;
				outputBuffer[2] = 1;
			}

		` );

		this.writeEscapedRayDispatchSizeKernel = writeEscapedRayDispatchSize( writeEscapedRayDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		this.bsdfDispatchBuffer = new StorageBufferAttribute( new Uint32Array( 3 ) );
		const writeBsdfDispatchSizeParams = {
			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),

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

				let count = atomicLoad(&queueSizes[2]);
				outputBuffer[0] = count / workgroupSize;
				outputBuffer[1] = 1;
				outputBuffer[2] = 1;
			}
		`, );

		this.writeBsdfDispatchSizeKernel = writeBsdfDispatchSize( writeBsdfDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

	}

	useMegakernel( useMegakernel ) {

		this.useMegakernel = useMegakernel;
		this.reset();

	}

	// compileMaterial() {

	// 	return this._renderer.compileAsync( this._fsQuad._mesh );

	// }

	setCamera( camera ) {

		this.camera = camera;

	}

	setSize( w, h ) {

		w = Math.ceil( w );
		h = Math.ceil( h );

		if ( this.dimensions.x === w && this.dimensions.y === h ) {

			return;

		}

		this.dimensions.set( w, h );
		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 * w * h ) );
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( w * h ) );
		// TODO: update wavefront queues

		// this._blendTargets[ 0 ].setSize( w, h );
		// this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	getSize( target ) {

		target.copy( this.dimensions );

	}

	dispose() {

		// this.resultTexture.dispose();
		// this._blendTargets[ 0 ].dispose();
		// this._blendTargets[ 1 ].dispose();
		// this._sobolTarget.dispose();

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

		this.resetKernel.computeNode.parameters.dimensions.value.copy( this.dimensions );
		this.resetKernel.computeNode.parameters.resultBuffer.value = this.resultBuffer;
		_renderer.compute( this.resetKernel, dispatchSize );

		this.megakernelParams.seed.value = 0;

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

		// const tmp = this.resultTextures[ 0 ];
		// this.resultTextures[ 0 ] = this.resultTextures[ 1 ];
		// this.resultTextures[ 1 ] = tmp;

		this.megakernelParams.seed.value += 1;
		// this.megakernelParams.outputTex.value = this.resultTextures[ 0 ];
		// this.megakernelParams.prevTex.value = this.resultTextures[ 1 ];
		this.megakernelParams.resultBuffer.value = this.resultBuffer;
		this.megakernelParams.sample_count_buffer.value = this.sampleCountBuffer;
		this.megakernelParams.dimensions.value.copy( this.dimensions );
		this.megakernelParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.megakernelParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

	getResultBuffer() {

		return this.resultBuffer;

	}

}
