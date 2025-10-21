import { SphereGeometry, StorageBufferAttribute, Matrix4, Vector3, NearestFilter, DataTexture, StorageTexture, NodeMaterial } from 'three/webgpu';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/fullscreen/BlendMaterial.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { PhysicalPathTracingMaterial } from '../materials/pathtracing/PhysicalPathTracingMaterial.js';
import { bvhIntersectFirstHit, ndcToCameraRay } from 'three-mesh-bvh/webgpu';
import { storageTexture, wgsl, wgslFn, textureStore, uniform, storage, workgroupId, localId, globalId } from 'three/tsl';
import { MeshBVH, SAH } from 'three-mesh-bvh';

function* renderTask() {

	while ( true ) {

		const { megakernel, _renderer, resultTextures, WORKGROUP_SIZE } = this;

		const dispatchSize = [
			Math.ceil( resultTextures[ 0 ].width / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( resultTextures[ 0 ].height / WORKGROUP_SIZE[ 1 ] ),
			1
		];

		_renderer.compute( megakernel, dispatchSize );

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
		// From RayTracingGems v1.9 chapter 16.6.2
		// https://www.realtimerendering.com/raytracinggems/unofficial_RayTracingGems_v1.9.pdf
		// result.xyz = cosine-wighted vector on the hemisphere oriented to a vector
		// result.w = pdf
		const sampleSphereCosineFn = wgslFn( /* wgsl */ `
			fn sampleSphereCosine(rng: vec2f, n: vec3f) -> vec4f {

				const PI: f32 = 3.141592653589793;
				let a = (1 - 2 * rng.x) * 0.99999;
				let b = sqrt( 1 - a * a ) * 0.99999;
				let phi = 2 * PI * rng.y;
				let direction = vec3f(n.x + b * cos( phi ), n.y + b * sin( phi ), n.z + a);
				let pdf = abs( a ) / PI;

				return vec4f( normalize( direction ), pdf );
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

		this.resultTextures = [ new StorageTexture(), new StorageTexture() ];
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( 1 ) );

		const megakernelShaderParams = {
			prevTex: storageTexture( this.resultTextures[ 0 ] ).toReadOnly(),
			outputTex: storageTexture( this.resultTextures[ 1 ] ).toWriteOnly(),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			// TODO: Think of a better to get size of wgsl structs?
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
				prevTex: texture_storage_2d<rgba8unorm, read>,
				outputTex: texture_storage_2d<rgba8unorm, write>,
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
				let dimensions = textureDimensions( outputTex );
				let indexUV = globalId.xy;
				let uv = vec2f( indexUV ) / vec2f( dimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				var rngState: PcgState;
				pcg_initialize(&rngState, indexUV, seed);

				// scene ray
				// TODO: sample a random ray
				var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

				const bounces: u32 = 7;
				var resultColor = vec3f( 0.0 );
				var throughputColor = vec3f( 1.0 );
				var sampleCount = 0u;
				// TODO: fix shadow acne? RTIOW says we could just ignore ray hits that are too close
				for (var bounce = 0u; bounce < bounces; bounce++) {
					let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

					// write result
					if ( hitResult.didHit) {

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

						throughputColor *= material.albedo * scatterRec.value / scatterRec.pdf;

						ray.origin = hitPosition;
						ray.direction = scatterRec.direction;

					} else {

						let background = vec3f( 0.0366, 0.0813, 0.1057 );
						resultColor += background * throughputColor;
						sampleCount += 1;
						break;
					}

				}

				if ( sampleCount == 0 ) {
					return;
				}

				let offset = globalId.x + globalId.y * dimensions.x;
				let prevSampleCount = sample_count_buffer[offset];
				let newSampleCount = prevSampleCount + sampleCount;
				sample_count_buffer[offset] = newSampleCount;

				let prevColor = textureLoad( prevTex, indexUV );
				let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
				textureStore( outputTex, indexUV, vec4f( newColor, 1.0 ) );

			}
		`, [ ndcToCameraRay, bvhIntersectFirstHit, materialStruct, surfaceRecordStruct, pcgRand3, pcgInit, lambertBsdfFunc ] );

		this.megakernel = megakernelComputeShader( megakernelShaderParams ).computeKernel( this.WORKGROUP_SIZE );

		const resetParams = {
			outputTex: textureStore( this.resultTextures[ 0 ] ).toWriteOnly(),
			prevTex: textureStore( this.resultTextures[ 1 ] ).toWriteOnly(),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),

			globalId: globalId,
		};

		const resetComputeShader = wgslFn( /* wgsl */ `

			fn reset(
				prevTex: texture_storage_2d<rgba8unorm, write>,
				outputTex: texture_storage_2d<rgba8unorm, write>,
				sample_count_buffer: ptr<storage, array<u32>, read_write>,

				globalId: vec2u,
			) -> void {

				textureStore( outputTex, globalId, vec4f( 0.0, 0.0, 0.0, 1.0 ) );
				textureStore( prevTex, globalId, vec4f( 0.0, 0.0, 0.0, 1.0 ) );
				let dimensions = textureDimensions( outputTex );
				let offset = globalId.x + globalId.y * dimensions.x;
				sample_count_buffer[offset] = 0;

			}

		` );

		this.resetKernel = resetComputeShader( resetParams ).computeKernel( this.WORKGROUP_SIZE );

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

		if ( this.resultTextures[ 0 ].width === w && this.resultTextures[ 0 ].height === h ) {

			return;

		}

		this.resultTextures.forEach( tex => tex.setSize( w, h, 1 ) );
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( w * h ) );

		// this._blendTargets[ 0 ].setSize( w, h );
		// this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	getSize( target ) {

		target.x = this.resultTextures[ 0 ].width;
		target.y = this.resultTextures[ 0 ].height;

	}

	dispose() {

		this.resultTexture.dispose();
		this.
		// this._blendTargets[ 0 ].dispose();
		// this._blendTargets[ 1 ].dispose();
		// this._sobolTarget.dispose();

		// this._fsQuad.dispose();
		// this._blendQuad.dispose();
			this._task = null;

	}

	reset() {

		const { _renderer, resultTextures } = this;

		const dispatchSize = [
			Math.ceil( resultTextures[ 0 ].width / this.WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( resultTextures[ 0 ].height / this.WORKGROUP_SIZE[ 1 ] ),
			1
		];

		this.resetKernel.computeNode.parameters.outputTex.value = resultTextures[ 0 ];
		this.resetKernel.computeNode.parameters.prevTex.value = resultTextures[ 1 ];
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

		const tmp = this.resultTextures[ 0 ];
		this.resultTextures[ 0 ] = this.resultTextures[ 1 ];
		this.resultTextures[ 1 ] = tmp;

		this.megakernelParams.seed.value += 1;
		this.megakernelParams.outputTex.value = this.resultTextures[ 0 ];
		this.megakernelParams.prevTex.value = this.resultTextures[ 1 ];
		this.megakernelParams.sample_count_buffer.value = this.sampleCountBuffer;
		this.megakernelParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.megakernelParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

	getResultTexture() {

		return this.resultTextures[ 0 ];

	}

}
