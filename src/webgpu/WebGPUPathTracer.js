import { Box3, DataTexture, LinearFilter, Vector2, Scene, PerspectiveCamera, Color, NoToneMapping, FloatType, Timer, StorageTexture, MeshBasicNodeMaterial, Matrix4, WebGPUCoordinateSystem } from 'three/webgpu';
import { uv, uniform, varying } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH } from 'three-mesh-bvh';
import { ndcToCameraRay, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { getDebugBoundsFunction } from './nodes/debugBounds.wgsl.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { PathtracerBVHComputeData } from './nodes/PathtracerBVHComputeData.js';
import { AtlasDebugMaterial } from './materials/debug/AtlasDebugMaterial.js';
import { SampleDensityMaterial } from './materials/debug/SampleDensityMaterial.js';
import { setCommonAttributes } from '../core/utils/GeometryPreparationUtils.js';
import { GltfCompliantMaterial } from './materials/GltfCompliantMaterial.js';
import { TRANSMISSIVE_BACKGROUND_OVERLAY } from './constants.js';
import * as RANDOM_BLUE_DITHER from './nodes/rand/bluedither.wgsl.js';

const _resolution = new Vector2();
const _color = new Color();

class TextureCache {

	constructor( renderer, key ) {

		this.key = key;
		this.renderer = renderer;
		this.texture = null;
		this.hash = null;

		const colorTex = new DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );
		colorTex.minFilter = LinearFilter;
		colorTex.magFilter = LinearFilter;
		this.colorTex = colorTex;

	}

	dispose() {

		this.colorTex.dispose();
		this.texture?.dispose();

	}

	setFromScene( scene ) {

		const { renderer, key, colorTex } = this;
		let value = scene[ key ];
		let hash = '';

		if ( ! value ) {

			const clearAlpha = renderer.getClearAlpha();
			renderer.getClearColor( _color );

			colorTex.image.data[ 0 ] = _color.r * 255;
			colorTex.image.data[ 1 ] = _color.g * 255;
			colorTex.image.data[ 2 ] = _color.b * 255;
			colorTex.image.data[ 3 ] = clearAlpha * 255;

			value = colorTex;
			hash = colorTex.image.data.join();
			colorTex.needsUpdate = hash !== this.hash;

		} else if ( value.isColor ) {

			colorTex.image.data[ 0 ] = value.r * 255;
			colorTex.image.data[ 1 ] = value.g * 255;
			colorTex.image.data[ 2 ] = value.b * 255;
			colorTex.image.data[ 3 ] = 255;

			value = colorTex;
			hash = colorTex.image.data.join();
			colorTex.needsUpdate = hash !== this.hash;

		} else if ( value.isCubeTexture ) {

			hash = null;
			value = new CubeToEquirectGenerator( renderer ).generate( value );

		} else {

			value = value.clone();
			hash = value.uuid + '_' + value.version;

		}

		if ( hash === null ) {

			this.texture?.dispose();

			this.texture = value;
			this.hash = null;
			return true;

		} else {

			const needsUpdate = hash !== this.hash;
			if ( needsUpdate ) {

				this.texture?.dispose();
				this.texture = value;

			}

			return needsUpdate;

		}

	}

}

export class WebGPUPathTracer {

	get bounces() {

		return this._pathTracer.bounces;

	}

	set bounces( v ) {

		this._pathTracer.bounces = v;
		this._pathTracer.reset();

	}

	// Per pixel sample counts. Use "min" for convergence checks, "avg" to display. Measures on the
	// wavefront backend, so only call it when the numbers are needed.
	async getSampleCountsAsync() {

		const pathTracer = this._pathTracer;

		// written in place. reset swaps in a new object so a late measurement can't overwrite it.
		const counts = this._lastSampleCounts;
		const measured = await pathTracer.getSampleCountsAsync();
		const lowResMode = pathTracer.lowResMode;

		counts.min = lowResMode ? 0 : measured.min;
		counts.max = lowResMode ? 0 : measured.max;
		counts.avg = lowResMode ? 0 : measured.avg;

		// averaged over the whole render, and idle time counts against it
		const elapsed = this.getRenderTime() / 1000;
		counts.samplesPerSecond = elapsed > 0 ? counts.avg / elapsed : 0;

		return { ...counts };

	}

	get transmissiveBackground() {

		return this._transmissiveBackground;

	}

	set transmissiveBackground( v ) {

		if ( this._transmissiveBackground !== v ) {

			this._transmissiveBackground = v;
			this._pathTracer.setTransmissiveBackground( v );

		}

	}

	get filterGlossyFactor() {

		return this._filterGlossyFactor;

	}

	set filterGlossyFactor( v ) {

		if ( this._filterGlossyFactor !== v ) {

			this._filterGlossyFactor = v;
			this._pathTracer.setFilterGlossy( v );

		}

	}

	// --- WebGLPathTracer compatibility stubs ---
	// These mirror the WebGLPathTracer API surface so existing examples run unchanged.
	// They are currently no-ops on the WebGPU path tracer until the corresponding
	// features are implemented.
	get tiles() {

		return this._pathTracer.tiles;

	}

	get target() {

		return this._pathTracer.outputTarget ?? null;

	}

	updateLights() {}

	// --- end compatibility stubs ---

	get fadeState() {

		return this._fadeState;

	}

	get textureAtlas() {

		return this._bvhData.textureAtlas;

	}

	useMegakernel( value ) {

		this._pathTracer.dispose();
		this._pathTracer = value ? new MegaKernelPathTracer( this._renderer ) : new WaveFrontPathTracer( this._renderer );
		this._pathTracer.setBVHData( this._bvhData );
		this._pathTracer.setMaterial( this.material );
		this._pathTracer.setRandom( this.random );
		this._pathTracer.setTransmissiveBackground( this._transmissiveBackground );
		this._pathTracer.setFilterGlossy( this._filterGlossyFactor );
		this.setCamera( this.camera );
		this.updateEnvironment();

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._timer = new Timer();

		this._environmentCache = new TextureCache( renderer, 'environment' );
		this._backgroundCache = new TextureCache( renderer, 'background' );

		this._resetTime = - 1;
		this._fadeState = 0;
		this._lastSampleCounts = { min: 0, max: 0, avg: 0, samplesPerSecond: 0 };
		this._size = new Vector2();
		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// avoid mipmap gen on copy, not always supported with float type
		this._lowResTarget = new StorageTexture( 1, 1 );
		this._lowResTarget.type = FloatType;
		this._lowResTarget.generateMipmaps = false;

		this._pathTracer = new WaveFrontPathTracer( renderer );

		// options
		this.minSamples = 1;
		this.renderDelay = 500;
		this.fadeDuration = 500;
		this.dynamicLowRes = true;
		this.lowResScale = 0.25;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.generateMissingAttributes = true;
		this.commonAttributes = [ 'normal', 'tangent' ];
		this.stableNoise = true;
		this.pause = false;

		this.filterGlossyFactor = 1;

		// WebGLPathTracer compatibility stubs (see getters above)
		// TOOD: implement these correctly
		this.multipleImportanceSampling = true;
		this.transmissiveBackground = TRANSMISSIVE_BACKGROUND_OVERLAY;

		this.random = RANDOM_BLUE_DITHER;
		this.material = new GltfCompliantMaterial();

		// default camera ray generation ( perspective / orthographic ), assigned onto each bvh compute
		// data's fns so the kernels can proxy it. The uniform is the inverse view-projection
		// ( world * inverseProjection ), premultiplied on the CPU so no matrix multiply runs per ray.
		this._invViewProjectionMatrix = uniform( new Matrix4() );
		this._cameraRayFnHandle = null;

		// initialize the scene so it doesn't fail
		this.setMaterial( this.material );
		this.setRandom( this.random );
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setScene( scene, camera ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		// Build BVH for each mesh geometry
		scene.traverse( child => {

			if ( this.generateMissingAttributes && child.geometry?.isBufferGeometry ) {

				setCommonAttributes( child.geometry, this.commonAttributes );

			}

			if ( child.isSkinnedMesh ) {

				if ( ! child.boundsTree ) {

					child.boundsTree = new SkinnedMeshBVH( child, { strategy: SAH, targetLeafSize: 5, indirect: true } );

				} else {

					child.boundsTree.refit();

				}

				if ( child.boundingBox === null ) {

					child.boundingBox = new Box3();

				}

				child.boundsTree.getBoundingBox( child.boundingBox );

			} else if ( child.isMesh ) {

				if ( ! child.geometry.boundsTree ) {

					child.geometry.boundsTree = new MeshBVH( child.geometry, { strategy: SAH, targetLeafSize: 5 } );

				}

			}

		} );

		// Build TLAS and compute functions
		const bvhData = new PathtracerBVHComputeData( scene );
		bvhData.update();
		bvhData.textureAtlas.setTextures( this._renderer, bvhData.textures );

		if ( this._bvhData ) {

			this._bvhData.dispose();
			this._bvhData.textureAtlas.dispose();

		}

		this.scene = scene;
		this._bvhData = bvhData;
		this._pathTracer.setBVHData( bvhData );
		this.setCamera( camera );
		this.updateEnvironment();

	}

	// TODO: consider renaming these functions or removing them
	getMaterial() {

		return this.material;

	}

	setMaterial( material ) {

		this.material = material;
		this._pathTracer.setMaterial( material );
		this.reset();

	}

	setRandom( random ) {

		this.random = random;
		this._pathTracer.setRandom( random );
		this.reset();

	}

	setCamera( camera ) {

		this.camera = camera;

		if ( camera.getCameraRayFn ) {

			this._cameraRayFnHandle = camera.getCameraRayFn();

		} else {

			// add a default camera ray getter. the update function is called when the camera is
			// updated to trigger any necessary uniform updates.
			const invViewProjectionMatrix = this._invViewProjectionMatrix;
			this._cameraRayFnHandle = {
				update: () => {

					camera.coordinateSystem = WebGPUCoordinateSystem;
					camera.updateMatrixWorld();

					if ( camera.isOrthographicCamera || camera.isPerspectiveCamera ) {

						camera.updateProjectionMatrix();

					}

					invViewProjectionMatrix.value.multiplyMatrices( camera.matrixWorld, camera.projectionMatrixInverse );
					return false;

				},
				fn: wgslTagFn/* wgsl */`
					fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

						let ndc = uv * 2.0 - vec2f( 1.0 );
						*ray = ${ ndcToCameraRay }( ndc, ${ invViewProjectionMatrix } );
						return true;

					}
				`,
			};

		}

		this._bvhData.fns.getCameraRay = this._cameraRayFnHandle.fn;
		this._cameraRayFnHandle.update();
		this._pathTracer.rebuild();
		this.reset();

	}

	updateMaterials() {

		const { _bvhData, _renderer } = this;
		_bvhData.updateMaterials();
		_bvhData.textureAtlas.setTextures( _renderer, _bvhData.textures );
		this.reset();

	}

	updateTransforms() {

		this.scene.updateMatrixWorld( true );
		this._bvhData.updateTransforms();
		this.reset();

	}

	updateCamera() {

		const { _cameraRayFnHandle, _pathTracer } = this;
		if ( _cameraRayFnHandle.update() ) {

			_pathTracer.rebuild();

		}

		this.reset();

	}

	updateEnvironment() {

		const {
			_pathTracer,
			scene,

			_environmentCache,
			_backgroundCache,
		} = this;

		// update the texture if they've changed
		if ( _environmentCache.setFromScene( scene ) ) {

			_pathTracer.setEnvironment( _environmentCache.texture );

		}

		if ( _backgroundCache.setFromScene( scene ) ) {

			_pathTracer.setBackground( _backgroundCache.texture );

		}

		// update the params always since they're cheap
		_pathTracer.setEnvironmentParams(
			scene.environmentIntensity,
			scene.environmentRotation,
		);

		_pathTracer.setBackgroundParams(
			scene.backgroundIntensity,
			scene.backgroundRotation,
			scene.backgroundBlurriness,
		);

		this.reset();

	}

	setSize( x, y ) {

		if ( this._size.x !== x || this._size.y !== y ) {

			this._size.set( x, y );
			this.reset();

		}

	}

	reset() {

		this._pathTracer.reset();
		this._resetTime = - 1;
		this._fadeState = 0;
		this._timer.update();

		// a fresh object rather than a clear, so measurements still in flight detach
		this._lastSampleCounts = { min: 0, max: 0, avg: 0, samplesPerSecond: 0 };

		if ( this.stableNoise ) {

			this._pathTracer.resetSeed();

		}

	}

	renderSample() {

		const renderer = this._renderer;
		const size = this._size;
		const blitQuad = this._blitQuad;
		const pathTracer = this._pathTracer;
		const lowResTarget = this._lowResTarget;
		const timer = this._timer;
		const {
			renderDelay,
			dynamicLowRes,
			synchronizeRenderSize,
			renderScale,
			lowResScale,
			minSamples,
		} = this;

		timer.update();

		if ( ! this._renderer._initialized ) {

			return;

		}

		if ( ! this.material.initialized ) {

			this.material.init( renderer );
			this.material.initialized = true;

		}

		let delta = 1000 * timer.getDelta();
		const firstFrame = this._resetTime === - 1;
		if ( firstFrame ) {

			this._resetTime = 0;
			delta = 0.0;

		}

		this._resetTime += delta;

		const originalTarget = renderer.getRenderTarget();
		const originalAutoClear = renderer.autoClear;

		// handle canvas-size auto synchronization
		if ( synchronizeRenderSize ) {

			renderer.getDrawingBufferSize( _resolution );
			const w = Math.floor( renderScale * _resolution.x );
			const h = Math.floor( renderScale * _resolution.y );
			this.setSize( w, h );

		}

		// check if we should be in low res mode and calculate the target size
		let { width, height } = size;
		const lowResMode = this._resetTime < renderDelay || ( firstFrame && dynamicLowRes && minSamples !== 0 );
		if ( lowResMode ) {

			width = Math.ceil( lowResScale * width );
			height = Math.ceil( lowResScale * height );

		}

		// set the size if necessary
		pathTracer.getSize( _resolution );

		const resized = _resolution.x !== width || _resolution.y !== height;
		if ( resized ) {

			if ( ! lowResMode && dynamicLowRes ) {

				// copy the low reset content if we're transitioning to the full
				// resolution view so we can fade to it
				lowResTarget.setSize( Math.ceil( lowResScale * width ), Math.ceil( lowResScale * height ) );
				renderer.copyTextureToTexture( pathTracer.outputTarget, lowResTarget );

			}

			pathTracer.setSize( width, height );

		}

		// update the samples
		if ( ! this.pause && ( ! lowResMode || ( lowResMode && dynamicLowRes ) ) ) {

			pathTracer.lowResMode = lowResMode;
			pathTracer.update();

		}

		// Gate on the least converged pixel. Measuring is expensive so it stops once faded in, and
		// the check reads the last measurement rather than waiting on this one.
		if ( ! lowResMode ) {

			if ( this._fadeState < 1 && minSamples > 0 ) {

				this.getSampleCountsAsync();

			}

			if ( this._lastSampleCounts.min >= minSamples ) {

				this._fadeState += delta / this.fadeDuration;
				this._fadeState = Math.min( 1.0, this._fadeState ) || 1.0;

			}

		}


		// render the content to the canvas
		const opacity = ( lowResMode && dynamicLowRes ? 1.0 : this._fadeState );

		renderer.autoClear = dynamicLowRes ? true : opacity === 1.0;
		blitQuad.material.transition = dynamicLowRes ? opacity : 1.0;
		blitQuad.material.opacity = dynamicLowRes ? 1.0 : opacity;
		blitQuad.material.fromTexture = lowResTarget;
		blitQuad.material.texture = pathTracer.outputTarget;
		blitQuad.render( renderer );

		// reset the renderer
		renderer.autoClear = originalAutoClear;
		renderer.setRenderTarget( originalTarget );

	}

	// Renders a full-screen heatmap of how many BVH bounding boxes each camera ray
	// intersects. Brighter / hotter pixels traverse more nodes, which is useful for
	// diagnosing bounding box overlap and traversal cost.
	//
	// options:
	// - displayTLAS: count the top-level (object) bounding boxes
	// - displayBLAS: count the per-object geometry bounding boxes
	// - stopAtSurface: only count boxes in front of the nearest hit surface, so boxes
	//     occluded by geometry don't contribute (front / backface culling and material
	//     transparency are honored via the path tracer's own first-hit raycast)
	// - saturationCount: node count that saturates to full heat (upper bound of the ramp)
	renderDebugBounds( options = {} ) {

		const {
			displayTLAS = true,
			displayBLAS = true,
			stopAtSurface = false,
			saturationCount = 64,
		} = options;

		const renderer = this._renderer;
		const camera = this.camera;

		if ( ! renderer._initialized ) {

			return;

		}

		camera.updateMatrixWorld();

		// (re)build the quad if it hasn't been built or the bvh data has changed
		if ( this._debugBoundsQuad === undefined || this._debugBoundsData !== this._bvhData ) {

			this._buildDebugBoundsQuad();

		}

		const uniforms = this._debugBoundsUniforms;
		uniforms.cameraToModelMatrix.value.copy( camera.matrixWorld );
		uniforms.inverseProjectionMatrix.value.copy( camera.projectionMatrixInverse );
		uniforms.displayTLAS.value = displayTLAS ? 1 : 0;
		uniforms.displayBLAS.value = displayBLAS ? 1 : 0;
		uniforms.stopAtSurface.value = stopAtSurface ? 1 : 0;
		uniforms.saturationCount.value = saturationCount;

		const originalTarget = renderer.getRenderTarget();
		const originalAutoClear = renderer.autoClear;
		const originalToneMapping = renderer.toneMapping;

		renderer.setRenderTarget( null );
		renderer.autoClear = true;
		renderer.toneMapping = NoToneMapping;

		this._debugBoundsQuad.render( renderer );

		renderer.setRenderTarget( originalTarget );
		renderer.autoClear = originalAutoClear;
		renderer.toneMapping = originalToneMapping;

	}

	_buildDebugBoundsQuad() {

		const bvhData = this._bvhData;
		const debugBounds = getDebugBoundsFunction( bvhData );

		const material = new MeshBasicNodeMaterial();
		material.colorNode = debugBounds( varying( uv() ) );

		if ( this._debugBoundsQuad === undefined ) {

			this._debugBoundsQuad = new FullScreenQuad( material );

		} else {

			this._debugBoundsQuad.material.dispose();
			this._debugBoundsQuad.material = material;

		}

		this._debugBoundsUniforms = debugBounds.uniforms;
		this._debugBoundsData = bvhData;

	}

	renderTextureAtlas( layer = 0 ) {

		const renderer = this._renderer;

		if ( ! this._atlasDebugQuad ) {

			this._atlasDebugQuad = new FullScreenQuad( new AtlasDebugMaterial() );

		}

		const quad = this._atlasDebugQuad;
		quad.material.texture = this.textureAtlas.texture;
		quad.material.layer = layer;
		renderer.setRenderTarget( null );
		quad.render( renderer );

	}

	// Renders a heatmap of the per pixel sample counts. Measures on every call, drawing with the
	// previous result since the readback lands a frame later.
	// TODO: bind the counters buffer in the shader instead to avoid the readback.
	renderSampleDensity() {

		const renderer = this._renderer;

		if ( ! renderer._initialized ) {

			return;

		}

		this.getSampleCountsAsync();

		if ( ! this._sampleDensityQuad ) {

			this._sampleDensityQuad = new FullScreenQuad( new SampleDensityMaterial() );

		}

		const originalToneMapping = renderer.toneMapping;
		renderer.toneMapping = NoToneMapping;

		const quad = this._sampleDensityQuad;
		quad.material.texture = this._pathTracer.sampleCountTarget;
		quad.material.minCount = this._lastSampleCounts.min;
		quad.material.maxCount = this._lastSampleCounts.max;
		renderer.setRenderTarget( null );
		quad.render( renderer );

		renderer.toneMapping = originalToneMapping;

	}

	dispose() {

		this._pathTracer.dispose();
		this._bvhData.dispose();
		this._bvhData.textureAtlas.dispose();
		this._environmentCache.dispose();
		this._backgroundCache.dispose();
		this._blitQuad.dispose();
		this._lowResTarget.dispose();
		this._atlasDebugQuad?.dispose();
		this._sampleDensityQuad?.dispose();

		if ( this._debugBoundsQuad !== undefined ) {

			this._debugBoundsQuad.dispose();

		}

	}

	// Returns time since last reset in ms
	getRenderTime() {

		// TODO: this is not completely accurate if the user has not called "renderSample" continuously
		return this._resetTime;

	}

}
