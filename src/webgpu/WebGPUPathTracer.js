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
import { getLights } from '../core/utils/sceneUpdateUtils.js';
import { GltfCompliantMaterial } from './materials/GltfCompliantMaterial.js';
import { TRANSMISSIVE_BACKGROUND_OVERLAY } from './constants.js';
import * as RANDOM_BLUE_DITHER from './nodes/rand/bluedither.wgsl.js';
/** @import { Camera, Scene, Texture, WebGPURenderer } from 'three/webgpu' */
/** @import { OIDNDenoiser } from './denoise/OIDNDenoiser.js' */
/** @import { FSRUpscaler } from './upscale/FSRUpscaler.js' */
/** @import { PathtracingMaterial } from './materials/PathtracingMaterial.js' */

/**
 * A random number generator implementation the kernels sample with. Use one of the `RANDOM_PCG`,
 * `RANDOM_SOBOL`, or `RANDOM_BLUE_DITHER` modules rather than constructing one.
 * @typedef {Object} RandomGenerator
 */

/**
 * @typedef {Object} SampleCounts
 * @property {number} min - Lowest sample count of any pixel.
 * @property {number} max - Highest sample count of any pixel.
 * @property {number} avg - Mean sample count across the image.
 * @property {number} samplesPerSecond - Mean samples accumulated per second since the last reset.
 */

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
				this.hash = hash;

			}

			return needsUpdate;

		}

	}

}

/**
 * Progressive path tracer running on WebGPU. Call {@link WebGPUPathTracer#setScene} once,
 * then {@link WebGPUPathTracer#renderSample} every frame to accumulate samples into the canvas.
 *
 * The scene is captured when `setScene` is called, so changes to geometry, materials, lights, or
 * the environment afterward require the matching `update*` function. Any change that invalidates
 * the accumulated image restarts it.
 */
export class WebGPUPathTracer {

	/**
	 * Maximum number of times a ray can scatter before the path is terminated. Higher values
	 * resolve more indirect light at the cost of speed.
	 * @type {number}
	 * @default 15
	 */
	get maxBounces() {

		return this._pathTracer.maxBounces;

	}

	set maxBounces( v ) {

		this._pathTracer.maxBounces = v;
		this._pathTracer.reset();

	}

	/**
	 * Number of path slots dispatched per {@link WebGPUPathTracer#renderSample} call,
	 * independent of resolution. Raising it trades frame rate for convergence speed.
	 * @type {number}
	 * @default 250000
	 */
	get frameBudget() {

		return this._pathTracer.frameBudget;

	}

	set frameBudget( v ) {

		this._pathTracer.frameBudget = v;

	}

	/**
	 * Maximum number of alpha tested surfaces a ray can pass through. Counted separately from
	 * {@link WebGPUPathTracer#maxBounces} so foliage and cutouts cannot exhaust the bounce budget.
	 * @type {number}
	 * @default 5
	 */
	get maxTransparentBounces() {

		return this._pathTracer.maxTransparentBounces;

	}

	set maxTransparentBounces( v ) {

		this._pathTracer.maxTransparentBounces = v;
		this._pathTracer.reset();

	}

	/**
	 * Stops accumulating once every pixel reaches this many samples. A denoiser only runs once the
	 * render has stopped, so it has no effect while this is `0`.
	 * @type {number}
	 * @default 0
	 * @note `0` renders indefinitely.
	 */
	get maxSamples() {

		return this._pathTracer.maxSamples;

	}

	set maxSamples( v ) {

		this._pathTracer.maxSamples = v;

		// the settle point moved, so a finished pass may need to run again against a longer
		// render. The accumulated samples are still valid
		this._denoiser?.reset();

	}

	/**
	 * Measures the per pixel sample counts. Use `min` for convergence checks and `avg` to display.
	 * @returns {Promise<SampleCounts>}
	 * @note The wavefront backend reduces the counts on the GPU and reads them back, so only call
	 *   this when the numbers are needed.
	 */
	async getSampleCountsAsync() {

		const pathTracer = this._pathTracer;

		// written in place. reset swaps in a new object so a late measurement can't overwrite it.
		const counts = this._lastSampleCounts;
		const measured = await pathTracer.getSampleCountsAsync();

		counts.min = measured.min;
		counts.max = measured.max;
		counts.avg = measured.avg;

		// averaged over the whole render, and idle time counts against it
		const elapsed = this.getRenderTime() / 1000;
		counts.samplesPerSecond = elapsed > 0 ? counts.avg / elapsed : 0;

		return { ...counts };

	}

	/**
	 * How the background is treated behind transmissive surfaces. One of
	 * `TRANSMISSIVE_BACKGROUND_OVERLAY`, `TRANSMISSIVE_BACKGROUND_ENVIRONMENT`, or
	 * `TRANSMISSIVE_BACKGROUND_TRANSPARENT`.
	 * @type {number}
	 * @default TRANSMISSIVE_BACKGROUND_OVERLAY
	 */
	get transmissiveBackground() {

		return this._transmissiveBackground;

	}

	set transmissiveBackground( v ) {

		if ( this._transmissiveBackground !== v ) {

			this._transmissiveBackground = v;
			this._pathTracer.setTransmissiveBackground( v );

		}

	}

	/**
	 * Blurs sharp reflections seen through rough surfaces to suppress fireflies. Higher values
	 * remove more noise and more detail.
	 * @type {number}
	 * @default 1
	 * @note `0` disables the filter.
	 */
	get filterGlossyFactor() {

		return this._filterGlossyFactor;

	}

	set filterGlossyFactor( v ) {

		if ( this._filterGlossyFactor !== v ) {

			this._filterGlossyFactor = v;
			this._pathTracer.setFilterGlossy( v );

		}

	}

	/**
	 * Whether to combine light sampling and bsdf sampling with MIS. Disabling it makes lights
	 * noticeably noisier.
	 * @type {boolean}
	 * @default true
	 */
	get multipleImportanceSampling() {

		return this._multipleImportanceSampling;

	}

	set multipleImportanceSampling( v ) {

		if ( this._multipleImportanceSampling !== v ) {

			this.setMultipleImportanceSampling( v );

		}

	}

	/**
	 * Upper bound on the contribution of a directly lit path segment, for suppressing fireflies.
	 * @type {number}
	 * @default 0
	 * @note `0` disables the clamp. Clamping darkens the image and biases the result.
	 */
	get clampDirect() {

		return this._clampDirect;

	}

	set clampDirect( v ) {

		v = Math.max( 0, v );
		if ( this._clampDirect !== v ) {

			this._clampDirect = v;
			this._pathTracer.setClamping( v, this._clampIndirect );

		}

	}

	/**
	 * Upper bound on the contribution of an indirectly lit path segment, for suppressing
	 * fireflies.
	 * @type {number}
	 * @default 10
	 * @note `0` disables the clamp. Clamping darkens the image and biases the result.
	 */
	get clampIndirect() {

		return this._clampIndirect;

	}

	set clampIndirect( v ) {

		v = Math.max( 0, v );
		if ( this._clampIndirect !== v ) {

			this._clampIndirect = v;
			this._pathTracer.setClamping( this._clampDirect, v );

		}

	}

	/**
	 * The render target the accumulated samples are written into.
	 * @type {Texture|null}
	 * @readonly
	 */
	get target() {

		return this._pathTracer.outputTarget ?? null;

	}

	/**
	 * Progress of the fade from the low resolution preview to the full render, from 0 to 1.
	 * @type {number}
	 * @readonly
	 */
	get fadeState() {

		return this._fadeState;

	}

	/**
	 * The low resolution preview rendered while {@link WebGPUPathTracer#renderDelay} elapses.
	 * @type {Texture}
	 * @readonly
	 */
	get lowResTarget() {

		return this._lowResTarget;

	}

	/**
	 * Whether the tracer is currently rendering the low resolution preview.
	 * @type {boolean}
	 * @readonly
	 */
	get lowResMode() {

		return this._pathTracer.lowResMode;

	}

	/**
	 * The atlas every scene texture is packed into for the kernels to sample.
	 * @type {AtlasTexture}
	 * @readonly
	 */
	get textureAtlas() {

		return this._bvhData.textureAtlas;

	}

	/**
	 * Switches between the two tracing backends and rebuilds the kernels. The wavefront backend is
	 * used by default and is faster on most scenes.
	 *
	 * @param {boolean} value - `true` for the megakernel, `false` for the wavefront tracer.
	 * @private
	 */
	useMegakernel( value ) {

		const maxSamples = this._pathTracer.maxSamples;

		this._pathTracer.dispose();
		this._pathTracer = value ? new MegaKernelPathTracer( this._renderer ) : new WaveFrontPathTracer( this._renderer );
		this._pathTracer.maxSamples = maxSamples;
		this._pathTracer.setBVHData( this._bvhData );
		this._pathTracer.setMaterial( this.material );
		this._pathTracer.setRandom( this.random );
		this._pathTracer.setMultipleImportanceSampling( this.multipleImportanceSampling );
		this._pathTracer.setTransmissiveBackground( this._transmissiveBackground );
		this._pathTracer.setFilterGlossy( this._filterGlossyFactor );
		this._pathTracer.setClamping( this._clampDirect, this._clampIndirect );
		this.setCamera( this.camera );

		// the new tracer has default environment and background maps so apply the cached scene textures
		this._pathTracer.setEnvironment( this._environmentCache.texture );
		this._pathTracer.setBackground( this._backgroundCache.texture );
		this.updateEnvironment();
		this.updateLights();

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
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

		// optional post passes, attached with "setDenoiser" / "setUpscaler"
		this._denoiser = null;
		this._upscaler = null;

		// options

		/**
		 * Samples every pixel must reach before the full resolution render is faded in.
		 * @type {number}
		 * @default 1
		 */
		this.minSamples = 1;

		/**
		 * Milliseconds to show the low resolution preview for after a reset.
		 * @type {number}
		 * @default 500
		 */
		this.renderDelay = 500;

		/**
		 * Milliseconds taken to cross fade from the preview to the full render.
		 * @type {number}
		 * @default 500
		 */
		this.fadeDuration = 500;

		/**
		 * Whether to render a low resolution preview while the camera is moving.
		 * @type {boolean}
		 * @default true
		 */
		this.dynamicLowRes = true;

		/**
		 * Resolution of the low resolution preview, as a fraction of the render size.
		 * @type {number}
		 * @default 0.1
		 */
		this.lowResScale = 0.1;

		/**
		 * Resolution the path tracer renders at, as a fraction of the canvas size. Lowering it
		 * converges faster at the cost of detail, and pairs with an upscaler.
		 * @type {number}
		 * @default 1
		 */
		this.renderScale = 1;

		/**
		 * Whether to track the canvas size automatically. Set to `false` to drive the render
		 * size with {@link WebGPUPathTracer#setSize}.
		 * @type {boolean}
		 * @default true
		 */
		this.synchronizeRenderSize = true;

		/**
		 * Whether to generate the attributes in {@link WebGPUPathTracer#commonAttributes} on
		 * geometry that is missing them when the scene is set.
		 * @type {boolean}
		 * @default true
		 */
		this.generateMissingAttributes = true;

		/**
		 * Vertex attributes every geometry is expected to provide.
		 * @type {Array<string>}
		 * @default [ 'normal', 'tangent' ]
		 */
		this.commonAttributes = [ 'normal', 'tangent' ];

		/**
		 * Whether to restart the random sequence on reset so a given camera always produces the
		 * same image.
		 * @type {boolean}
		 * @default true
		 */
		this.stableNoise = true;

		/**
		 * Whether to stop accumulating samples. The last image keeps being presented.
		 * @type {boolean}
		 * @default false
		 */
		this.pause = false;

		this.filterGlossyFactor = 1;
		this._clampDirect = 0;
		this._clampIndirect = 10;
		this.multipleImportanceSampling = true;
		this.transmissiveBackground = TRANSMISSIVE_BACKGROUND_OVERLAY;

		/**
		 * Random number generator the kernels sample with.
		 * @type {RandomGenerator}
		 * @default RANDOM_BLUE_DITHER
		 * @note Assign through {@link WebGPUPathTracer#setRandom} so the kernels recompile.
		 */
		this.random = RANDOM_BLUE_DITHER;

		/**
		 * Material model the kernels evaluate surfaces with.
		 * @type {PathtracingMaterial}
		 * @private
		 */
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

	/**
	 * @param {boolean} value
	 */
	setMultipleImportanceSampling( value ) {

		this._multipleImportanceSampling = value;
		this._pathTracer.setMultipleImportanceSampling( value );
		this.reset();

	}

	/**
	 * Attaches a denoiser, run once the render settles and displayed in place of the raw image.
	 * Settings live on the instance. Pass null to remove it.
	 *
	 * @param {OIDNDenoiser|null} denoiser
	 */
	setDenoiser( denoiser ) {

		// a detached instance stops receiving resets, so clear it rather than let it hold a
		// result from a camera position that has since moved
		this._denoiser?.reset();
		this._denoiser = denoiser;

		if ( denoiser ) {

			denoiser.init( this._renderer );
			denoiser.setScene( this.scene, this.camera );

		}

	}

	/**
	 * Attaches an upscaler, run before the image is presented so the render can happen below the
	 * canvas resolution. Settings live on the instance. Pass null to remove it.
	 *
	 * @param {FSRUpscaler|null} upscaler
	 */
	setUpscaler( upscaler ) {

		this._upscaler = upscaler;

		if ( upscaler ) {

			upscaler.init( this._renderer );

		}

	}

	/**
	 * Captures the scene and camera and builds the acceleration structures the kernels trace
	 * against. Call this once, then use the `update*` functions for later changes.
	 *
	 * @param {Scene} scene
	 * @param {Camera} camera
	 * @note Geometry BVHs are built synchronously, so this blocks for large scenes.
	 */
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
		this.updateLights();

		// the denoiser rasterizes its own guide buffers, so it needs the scene too
		this._denoiser?.setScene( scene, camera );

	}

	/**
	 * @returns {PathtracingMaterial}
	 * @private
	 */
	// TODO: consider renaming these functions or removing them
	getMaterial() {

		return this.material;

	}

	/**
	 * Replaces the material model and recompiles the kernels.
	 *
	 * @param {PathtracingMaterial} material
	 * @private
	 */
	setMaterial( material ) {

		this.material = material;
		this._pathTracer.setMaterial( material );
		this.reset();

	}

	/**
	 * Replaces the random number generator and recompiles the kernels.
	 *
	 * @param {RandomGenerator} random
	 */
	setRandom( random ) {

		this.random = random;
		this._pathTracer.setRandom( random );
		this.reset();

	}

	/**
	 * Replaces the camera the rays are generated from. Cameras with a `getCameraRayFn`, such as
	 * `PhysicalCamera` and `EquirectCamera`, provide their own ray generation.
	 *
	 * @param {Camera} camera
	 */
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

	/**
	 * Re-reads the material properties and textures from the scene. Call after changing any
	 * material.
	 */
	updateMaterials() {

		const { _bvhData, _renderer } = this;
		_bvhData.updateMaterials();
		_bvhData.textureAtlas.setTextures( _renderer, _bvhData.textures );
		this.reset();

	}

	/**
	 * Re-reads the world matrices from the scene. Call after moving any object.
	 * @note Changing geometry requires {@link WebGPUPathTracer#setScene} instead, since the BVH
	 *   must be rebuilt.
	 */
	updateTransforms() {

		this.scene.updateMatrixWorld( true );
		this._bvhData.updateTransforms();
		this.reset();

	}

	/**
	 * Re-reads the camera transform and projection. Call after moving the camera.
	 */
	updateCamera() {

		const { _cameraRayFnHandle, _pathTracer } = this;
		if ( _cameraRayFnHandle.update() ) {

			_pathTracer.rebuild();

		}

		this.reset();

	}

	/**
	 * Re-reads `scene.environment` and `scene.background`, along with their intensity, rotation,
	 * and blur.
	 */
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

	/**
	 * Re-collects the lights in the scene. Call after adding, removing, or changing one.
	 */
	updateLights() {

		const { _pathTracer, scene } = this;

		const lights = getLights( scene );
		_pathTracer.setLights( lights );
		this.reset();

	}

	/**
	 * Sets the resolution the path tracer renders at. Only used when
	 * {@link WebGPUPathTracer#synchronizeRenderSize} is `false`.
	 *
	 * @param {number} x
	 * @param {number} y
	 */
	setSize( x, y ) {

		if ( this._size.x !== x || this._size.y !== y ) {

			this._size.set( x, y );
			this.reset();

		}

	}

	/**
	 * Discards the accumulated image and starts over. The `update*` functions call this for you.
	 */
	reset() {

		this._pathTracer.reset();
		this._denoiser?.reset();
		this._resetTime = - 1;
		this._fadeState = 0;
		this._timer.update();

		// a fresh object rather than a clear, so measurements still in flight detach
		this._lastSampleCounts = { min: 0, max: 0, avg: 0, samplesPerSecond: 0 };

		if ( this.stableNoise ) {

			this._pathTracer.resetSeed();

		}

	}

	/**
	 * Accumulates one round of samples and presents the result to the canvas. Call once per frame.
	 */
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
			maxSamples,
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

		const denoiser = this._denoiser;
		const upscaler = this._upscaler;

		// the denoiser runs once the render stops, so an uncapped render never denoises
		// TODO: this only needs to know whether the render stopped, but measures the per pixel
		// counts every frame. A count of the camera rays dispatched would answer it in one value
		const awaitingDenoise = Boolean( denoiser ) && ! denoiser.complete && ! denoiser.running && maxSamples > 0;

		// Gate on the least converged pixel. Measuring is expensive so it stops once faded in, and
		// the check reads the last measurement rather than waiting on this one.
		if ( ! lowResMode ) {

			if ( ( this._fadeState < 1 && minSamples > 0 ) || awaitingDenoise ) {

				this.getSampleCountsAsync();

			}

			if ( this._lastSampleCounts.min >= minSamples ) {

				this._fadeState += delta / this.fadeDuration;
				this._fadeState = Math.min( 1.0, this._fadeState ) || 1.0;

			}

		}


		// render the content to the canvas
		const opacity = ( lowResMode && dynamicLowRes ? 1.0 : this._fadeState );

		// the low res preview is replaced moments later, so it is neither denoised nor upscaled
		let texture = pathTracer.outputTarget;
		if ( denoiser && ! lowResMode ) {

			// "min" so every pixel has stopped, not just the average
			if ( awaitingDenoise && this._lastSampleCounts.min >= maxSamples ) {

				denoiser.update( pathTracer.outputTarget );

			}

			texture = denoiser.texture ?? texture;

		}

		if ( upscaler && ! lowResMode ) {

			texture = upscaler.upscale( texture, this.camera );

			// the pass above binds its own targets
			renderer.setRenderTarget( originalTarget );

		}

		renderer.autoClear = dynamicLowRes ? true : opacity === 1.0;
		blitQuad.material.transition = dynamicLowRes ? opacity : 1.0;
		blitQuad.material.opacity = dynamicLowRes ? 1.0 : opacity;
		blitQuad.material.fromTexture = lowResTarget;
		blitQuad.material.texture = texture;
		blitQuad.render( renderer );

		// reset the renderer
		renderer.autoClear = originalAutoClear;
		renderer.setRenderTarget( originalTarget );

	}

	/**
	 * Draws a heatmap of how many BVH bounding boxes each camera ray intersects, for diagnosing
	 * box overlap and traversal cost. Hotter pixels traverse more nodes.
	 *
	 * @param {Object} [options]
	 * @param {boolean} [options.displayTLAS=true] - Count the top level object bounding boxes.
	 * @param {boolean} [options.displayBLAS=true] - Count the per object geometry bounding boxes.
	 * @param {boolean} [options.stopAtSurface=false] - Only count boxes in front of the nearest
	 *   hit, so occluded boxes do not contribute. Culling and material transparency are honored.
	 * @param {number} [options.saturationCount=64] - Node count that saturates to full heat.
	 */
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

	/**
	 * Draws one layer of the texture atlas to the canvas, for debugging texture packing.
	 *
	 * @param {number} [layer=0]
	 */
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

	/**
	 * Draws a heatmap of the per pixel sample counts, for spotting pixels that converge slowly.
	 * @note Measures on every call and draws with the previous result, since the readback lands a
	 *   frame later.
	 */
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

	/**
	 * Frees every GPU resource held by the tracer, including any attached denoiser and upscaler.
	 */
	dispose() {

		this._pathTracer.dispose();
		this._denoiser?.dispose();
		this._upscaler?.dispose();
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

	/**
	 * Milliseconds elapsed since the last reset.
	 * @returns {number}
	 */
	// TODO: this is not completely accurate if the user has not called "renderSample" continuously
	getRenderTime() {

		return this._resetTime;

	}

}
