import { Color, StorageBufferAttribute, PerspectiveCamera, Scene, Vector2, Clock, NormalBlending, NoBlending, AdditiveBlending, NodeMaterial } from 'three/webgpu';
import { storage, uniform, wgslFn, uv, varying, positionGeometry } from 'three/tsl';
import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GradientEquirectTexture } from '../textures/GradientEquirectTexture.js';
import { getIesTextures, getLights, getTextures } from '../core/utils/sceneUpdateUtils.js';
import { ClampedInterpolationMaterial } from '../materials/fullscreen/ClampedInterpolationMaterial.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { PathTracerCore } from './PathTracerCore.js';

// function supportsFloatBlending( renderer ) {

// 	return renderer.extensions.get( 'EXT_float_blend' );

// }

const _resolution = new Vector2();
export class WebGPUPathTracer {

	// get multipleImportanceSampling() {

	// 	return Boolean( this._pathTracer.material.defines.FEATURE_MIS );

	// }

	// set multipleImportanceSampling( v ) {

	// 	this._pathTracer.material.setDefine( 'FEATURE_MIS', v ? 1 : 0 );

	// }

	// get transmissiveBounces() {

	// 	return this._pathTracer.material.transmissiveBounces;

	// }

	// set transmissiveBounces( v ) {

	// 	this._pathTracer.material.transmissiveBounces = v;

	// }

	get bounces() {

		return this._pathTracer.material.bounces;

	}

	set bounces( v ) {

		this._pathTracer.material.bounces = v;

	}

	// get filterGlossyFactor() {

	// 	return this._pathTracer.material.filterGlossyFactor;

	// }

	// set filterGlossyFactor( v ) {

	// 	this._pathTracer.material.filterGlossyFactor = v;

	// }

	// get samples() {

	// 	return this._pathTracer.samples;

	// }

	// get target() {

	// 	return this._pathTracer.target;

	// }

	// get tiles() {

	// 	return this._pathTracer.tiles;

	// }

	// get stableNoise() {

	// 	return this._pathTracer.stableNoise;

	// }

	// set stableNoise( v ) {

	// 	this._pathTracer.stableNoise = v;

	// }

	get isCompiling() {

		return Boolean( this._pathTracer.isCompiling );

	}

	useMegakernel( useMegakernel ) {

		this._renderer.useMegakernel( useMegakernel );

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._generator = new PathTracingSceneGenerator();
		this._pathTracer = new PathTracerCore( renderer );
		this._queueReset = false;
		this._clock = new Clock();
		this._compilePromise = null;

		this.tiles = new Vector2();

		// this._lowResPathTracer = new PathTracingRenderer( renderer );
		// this._lowResPathTracer.tiles.set( 1, 1 );
		// this._quad = new FullScreenQuad( new ClampedInterpolationMaterial( {
		// 	map: null,
		// 	transparent: true,
		// 	blending: NoBlending,

		// 	premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		// } ) );
		this._materials = null;

		this._previousEnvironment = null;
		this._previousBackground = null;
		this._internalBackground = null;

		// options
		this.renderDelay = 100;
		this.minSamples = 5;
		this.fadeDuration = 500;
		this.enablePathTracing = true;
		this.pausePathTracing = false;
		this.dynamicLowRes = false;
		this.lowResScale = 0.25;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.rasterizeScene = true;
		this.renderToCanvas = true;
		this.textureSize = new Vector2( 1024, 1024 );
		this.rasterizeSceneCallback = ( scene, camera ) => {

			this._renderer.render( scene, camera );

		};

		const blitMaterial = new NodeMaterial();
		const fragmentShaderParams = {
			resultBuffer: storage( new StorageBufferAttribute(), 'vec4' ),
			dimensions: uniform( new Vector2() ),
			uv: varying( uv() ),
		};

		// TODO: Apply gamma correction?
		const blitFragmentShader = wgslFn( /* wgsl */ `
			fn blit(
				resultBuffer: ptr<storage, array<vec4f>, read>,
				dimensions: vec2u,
				uv: vec2f,
			) -> vec4f {
				let x = min(u32( uv.x * f32(dimensions.x) ), dimensions.x - 1);
				let y = min(u32( uv.y * f32(dimensions.y) ), dimensions.y - 1);
				let offset = x + y * dimensions.x;
				return resultBuffer[offset];
			}
		` );

		blitMaterial.fragmentNode = blitFragmentShader( fragmentShaderParams );

		const vertexShaderParams = {
			position: positionGeometry,
		};
		const fullScreenQuadVertex = wgslFn( /* wgsl */ `
			fn noop(position: vec4f) -> vec4f {
				return position;
			}
		` );
		blitMaterial.vertexNode = fullScreenQuadVertex( vertexShaderParams );

		const blitQuad = new FullScreenQuad( blitMaterial );

		this.renderToCanvasCallback = ( finalBuffer, renderer, quad ) => {

			blitQuad.material.fragmentNode.parameters.resultBuffer.value = finalBuffer;
			const dimensions = blitQuad.material.fragmentNode.parameters.dimensions.value;
			this._renderer.getSize( dimensions );
			blitQuad.render( renderer );

			// const currentAutoClear = renderer.autoClear;
			// renderer.autoClear = false;
			// quad.render( renderer );
			// renderer.autoClear = currentAutoClear;

		};

		// initialize the scene so it doesn't fail
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setBVHWorker( worker ) {

		this._generator.setBVHWorker( worker );

	}

	setScene( scene, camera, options = {} ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		const generator = this._generator;
		generator.setObjects( scene );

		if ( this._buildAsync ) {

			return generator.generateAsync( options.onProgress ).then( result => {

				return this._updateFromResults( scene, camera, result );

			} );

		} else {

			const result = generator.generate();
			return this._updateFromResults( scene, camera, result );

		}

	}

	setSceneAsync( ...args ) {

		this._buildAsync = true;
		const result = this.setScene( ...args );
		this._buildAsync = false;

		return result;

	}

	setCamera( camera ) {

		this.camera = camera;
		this.updateCamera();

	}

	updateCamera() {

		const camera = this.camera;
		camera.updateMatrixWorld();

		this._pathTracer.setCamera( camera );
		// this._lowResPathTracer.setCamera( camera );
		this.reset();

	}

	updateMaterials() {

	}

	updateLights() {

	}

	updateEnvironment() {

	}

	_updateFromResults( scene, camera, results ) {

		const {
			materials,
			geometry,
			bvh,
			bvhChanged,
			needsMaterialIndexUpdate,
		} = results;

		const pathTracer = this._pathTracer;

		if ( bvhChanged ) {

			// dereference a new index attribute if we're using indirect storage
			const dereferencedIndexAttr = geometry.index.clone();
			const indirectBuffer = bvh._indirectBuffer;
			if ( indirectBuffer ) {

				dereferenceIndex( geometry, indirectBuffer, dereferencedIndexAttr );

			}

			const newIndex = new StorageBufferAttribute( dereferencedIndexAttr.array, 3 );
			pathTracer.megakernelParams.geom_index.value = newIndex;

			const newPosition = new StorageBufferAttribute( geometry.attributes.position.array, 3 );
			pathTracer.megakernelParams.geom_position.value = newPosition;

			const newNormals = new StorageBufferAttribute( geometry.attributes.normal.array, 3 );
			pathTracer.megakernelParams.geom_normals.value = newNormals;

			const newBvhRoots = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
			pathTracer.megakernelParams.bvh.value = newBvhRoots;

		}

		if ( needsMaterialIndexUpdate ) {

			const newMaterialIndex = new StorageBufferAttribute( geometry.attributes.materialIndex.array, 1 );
			pathTracer.megakernelParams.geom_material_index.value = newMaterialIndex;

		}

		const newMaterialsData = new Float32Array( materials.length * 3 );
		const defaultColor = new Color();
		for ( let i = 0; i < materials.length; i ++ ) {

			const material = materials[ i ];
			const color = material.color ?? defaultColor;
			// Make sure those are in linear-sRGB space
			newMaterialsData[ 3 * i + 0 ] = color.r;
			newMaterialsData[ 3 * i + 1 ] = color.g;
			newMaterialsData[ 3 * i + 2 ] = color.b;

		}

		const newMaterialsBuffer = new StorageBufferAttribute( newMaterialsData, 3 );
		pathTracer.megakernelParams.materials.value = newMaterialsBuffer;

		this.setCamera( camera );

	}

	renderSample() {

		if ( ! this._renderer._initialized ) {

			this._renderer.init();
			return;

		}

		this._updateScale();

		this._pathTracer.update();

		this.renderToCanvasCallback( this._pathTracer.getResultBuffer(), this._renderer );

	}

	reset() {

	}

	dispose() {

		this._pathTracer.dispose();

	}

	_updateScale() {

		// update the path tracer scale if it has changed
		if ( this.synchronizeRenderSize ) {

			this._renderer.getDrawingBufferSize( _resolution );

			const w = Math.floor( this.renderScale * _resolution.x );
			const h = Math.floor( this.renderScale * _resolution.y );

			this._pathTracer.getSize( _resolution );
			if ( _resolution.x !== w || _resolution.y !== h ) {

				this._pathTracer.setSize( w, h );

			}

		}

	}

}

// TODO: Expose in three-mesh-bvh?
function dereferenceIndex( geometry, indirectBuffer, target ) {

	const unpacked = target.array;
	const indexArray = geometry.index ? geometry.index.array : null;
	for ( let i = 0, l = indirectBuffer.length; i < l; i ++ ) {

		const i3 = 3 * i;
		const v3 = 3 * indirectBuffer[ i ];
		for ( let c = 0; c < 3; c ++ ) {

			unpacked[ i3 + c ] = indexArray ? indexArray[ v3 + c ] : v3 + c;

		}

	}

}
