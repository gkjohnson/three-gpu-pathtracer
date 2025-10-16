import { SphereGeometry, StorageBufferAttribute, Matrix4, Vector3, NearestFilter, DataTexture, StorageTexture, NodeMaterial } from 'three/webgpu';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/fullscreen/BlendMaterial.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { PhysicalPathTracingMaterial } from '../materials/pathtracing/PhysicalPathTracingMaterial.js';
import { bvhIntersectFirstHit, ndcToCameraRay } from 'three-mesh-bvh/webgpu';
import { wgsl, wgslFn, textureStore, uniform, storage, workgroupId, localId } from 'three/tsl';
import { MeshBVH, SAH } from 'three-mesh-bvh';

function* renderTask() {

	while ( true ) {

		const { megakernel, _renderer, resultTexture, WORKGROUP_SIZE } = this;

		const dispatchSize = [
			Math.ceil( resultTexture.width / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( resultTexture.height / WORKGROUP_SIZE[ 1 ] ),
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

		// const materialStruct = wgsl( /* wgsl */`
		// 	struct Material {
		// 		color: vec3f;
		// 	};
		// ` );

		this.resultTexture = new StorageTexture();

		const megakernelShaderParams = {
			outputTex: textureStore( this.resultTexture ),
			smoothNormals: uniform( 1 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			geom_index: storage( new StorageBufferAttribute( 0, 3 ), 'uvec3' ).toReadOnly(),
			geom_position: storage( new StorageBufferAttribute( 0, 3 ), 'vec3' ).toReadOnly(),
			geom_normals: storage( new StorageBufferAttribute( 0, 3 ), 'vec3' ).toReadOnly(),
			bvh: storage( new StorageBufferAttribute( 0, 8 ), 'BVHNode' ).toReadOnly(),

			// compute variables
			workgroupSize: uniform( new Vector3() ),
			workgroupId: workgroupId,
			localId: localId

		};

		const megakernelComputeShader = wgslFn( /* wgsl */`

			fn compute(
				outputTex: texture_storage_2d<rgba8unorm, write>,
				smoothNormals: u32,
				inverseProjectionMatrix: mat4x4f,
				cameraToModelMatrix: mat4x4f,
				geom_position: ptr<storage, array<vec3f>, read>,
				geom_index: ptr<storage, array<vec3u>, read>,
				geom_normals: ptr<storage, array<vec3f>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,
				workgroupSize: vec3u,
				workgroupId: vec3u,
				localId: vec3u,
			) -> void {

				// to screen coordinates
				let dimensions = textureDimensions( outputTex );
				let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
				let uv = vec2f( indexUV ) / vec2f( dimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				// scene ray
				var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

				// get hit result
				// let triCount = arrayLength(geom_index);
				// let hitResult = intersectTriangles( geom_position, geom_index, 0, triCount, ray );
				let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

				// write result
				if ( hitResult.didHit && hitResult.dist < 1.0 ) {

					let normal = select(
						hitResult.normal,
						normalize( getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals ) ),
						smoothNormals > 0u,
					);
					textureStore( outputTex, indexUV, vec4f( normal, 1.0 ) );

				} else {

					let background = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
					textureStore( outputTex, indexUV, background );

				}

			}
		`, [ ndcToCameraRay, bvhIntersectFirstHit ] );

		this.megakernel = megakernelComputeShader( megakernelShaderParams ).computeKernel( this.WORKGROUP_SIZE );

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

		if ( this.resultTexture.width === w && this.resultTexture.height === h ) {

			return;

		}

		this.resultTexture.setSize( w, h, 1 );

		// this._blendTargets[ 0 ].setSize( w, h );
		// this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	getSize( target ) {

		target.x = this.resultTexture.width;
		target.y = this.resultTexture.height;

	}

	dispose() {

		this.resultTexture.dispose();
		// this._blendTargets[ 0 ].dispose();
		// this._blendTargets[ 1 ].dispose();
		// this._sobolTarget.dispose();

		// this._fsQuad.dispose();
		// this._blendQuad.dispose();
		this._task = null;

	}

	reset() {

		const { _renderer, resultTexture } = this;
		// TODO: compute shader to reset resultTexture to 0

		// const ogRenderTarget = _renderer.getRenderTarget();
		// const ogClearAlpha = _renderer.getClearAlpha();
		// _renderer.getClearColor( ogClearColor );

		// _renderer.setRenderTarget( _primaryTarget );
		// _renderer.setClearColor( 0, 0 );
		// _renderer.clearColor();

		// _renderer.setRenderTarget( _blendTargets[ 0 ] );
		// _renderer.setClearColor( 0, 0 );
		// _renderer.clearColor();

		// _renderer.setRenderTarget( _blendTargets[ 1 ] );
		// _renderer.setClearColor( 0, 0 );
		// _renderer.clearColor();

		// _renderer.setClearColor( ogClearColor, ogClearAlpha );
		// _renderer.setRenderTarget( ogRenderTarget );

		this.samples = 0;
		this._task = null;

		// this.material.stratifiedTexture.stableNoise = this.stableNoise;
		// if ( this.stableNoise ) {

		// 	this.material.seed = 0;
		// 	this.material.stratifiedTexture.reset();

		// }

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

		this.megakernelParams.workgroupSize.value.fromArray( this.WORKGROUP_SIZE );
		this.megakernelParams.outputTex.value = this.resultTexture;
		this.megakernelParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.megakernelParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
