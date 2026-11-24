import { Box3, DataTexture, RGBAFormat, EventDispatcher, LinearFilter, RepeatWrapping, ClampToEdgeWrapping, MathUtils, Vector2, Scene, PerspectiveCamera, Color, NoToneMapping, HalfFloatType, Timer, MeshBasicNodeMaterial, Matrix4, WebGPUCoordinateSystem, RenderTarget, NormalBlending, NoBlending } from 'three/webgpu';
import { uv, uniform, varying } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH } from 'three-mesh-bvh';
import { ndcToCameraRay, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { getDebugBoundsFunction } from './nodes/debugBounds.wgsl.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { LightsInfoNode } from './LightsInfoNode.js';
import { EquirectBackgroundInfo } from './EquirectBackgroundInfo.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { toHalfFloatArray } from '../utils/TextureUtils.js';
import { FrameWatchdog } from '../utils/FrameWatchdog.js';
import { PathtracerBVHComputeData } from './nodes/PathtracerBVHComputeData.js';
import { AtlasDebugMaterial } from './materials/debug/AtlasDebugMaterial.js';
import { SampleDensityMaterial } from './materials/debug/SampleDensityMaterial.js';
import { AuxDebugMaterial } from './materials/debug/AuxDebugMaterial.js';
import { setCommonAttributes } from '../core/utils/GeometryPreparationUtils.js';
import { getLights } from '../core/utils/sceneUpdateUtils.js';
import { GLTFShadingModel } from './shadingModels/GLTFShadingModel.js';
import { expandByNearPlane } from './shims/nearPlaneBounds.js';
import { TRANSMISSIVE_BACKGROUND_OVERLAY, RANDOM_SOBOL } from './constants.js';
import { createOutputTarget } from './compute/targets.js';
/** @import { Camera, Scene, Texture, WebGPURenderer } from 'three/webgpu' */
/** @import { AtlasTexture } from './AtlasTexture.js' */
/** @import { OIDNDenoiser } from './denoise/OIDNDenoiser.js' */
/** @import { FSRUpscaler } from './upscale/FSRUpscaler.js' */
/** @import { ShadingModel } from './shadingModels/ShadingModel.js' */

/**
 * @typedef {Object} SampleCounts
 * @property {number} min - Lowest sample count of any pixel.
 * @property {number} max - Highest sample count of any pixel.
 * @property {number} avg - Mean sample count across the image.
 * @property {number} finished - Share of the pixels done sampling, at `maxSamples`.
 * @property {number} samplesPerSecond - Mean samples accumulated per second of render time since the last reset.
 * @property {number} renderTime - Milliseconds spent rendering samples since the last reset.
 * @property {number} elapsedTime - Milliseconds since rendering started after the last reset, including pauses but
 *   not the time the page is hidden.
 */

const _resolution = new Vector2();
const _color = new Color();
const _originBounds = /* @__PURE__ */ new Box3();
const _originToWorld = /* @__PURE__ */ new Matrix4();
const _rotationMatrix = /* @__PURE__ */ new Matrix4();
const _outputRegion = /* @__PURE__ */ new Box3();
const _drawingBufferSize = /* @__PURE__ */ new Vector2();

// milliseconds between sample count readbacks while waiting for the render to complete
const COMPLETE_CHECK_INTERVAL = 250;

// How the adaptive frame budget follows the measured frame time. The budget is only reconsidered once
// a window of measurements has been taken at it, and only changes when their average is off the target
// by the threshold ratio, since a wavefront budget change reallocates the path buffers. It moves at most
// the step ratio per window.
// TODO: adapt more often, with a window of around 4, once the wavefront path buffers are grow-only so a budget
// change only changes the active slot count rather than reallocating them
const BUDGET_WINDOW = 16;
const BUDGET_CHANGE_THRESHOLD = 1.15;
const BUDGET_MAX_STEP = 2;
const MIN_FRAME_BUDGET = 4096;

// the options the mesh geometry bvhs are built with and how many workers build them at once
const MESH_BVH_OPTIONS = { strategy: SAH, targetLeafSize: 5 };
const MAX_BVH_WORKERS = 4;

// the stages before a scene renders, in order
const STAGE_BUILDING = 0;
const STAGE_COMPILING = 1;
const STAGE_RENDERING = 2;

// Returns the BVHs to build for the scene's meshes, keyed by the geometry. The geometries of a BatchedMesh are built
// separately, since a single BVH would mix their triangles, and are keyed by their geometry info.
function getMissingBVHs( scene ) {

	const result = new Map();
	scene.traverse( child => {

		const { geometry } = child;
		if ( child.isBatchedMesh ) {

			child._geometryInfo.forEach( ( info, geometryId ) => {

				if ( info.active && ! child.boundsTrees?.[ geometryId ] ) {

					const range = child.getGeometryRangeAt( geometryId );
					result.set( info, {
						geometry,
						options: { ...MESH_BVH_OPTIONS, range },
						triangles: range.count / 3,
						setBVH: bvh => {

							child.boundsTrees = child.boundsTrees || [];
							child.boundsTrees[ geometryId ] = bvh;

						},
					} );

				}

			} );

		} else if ( child.isMesh && ! child.isSkinnedMesh && ! geometry.boundsTree ) {

			result.set( geometry, {
				geometry,
				options: MESH_BVH_OPTIONS,
				triangles: ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3,
				setBVH: bvh => {

					geometry.boundsTree = bvh;

				},
			} );

		}

	} );

	return result;

}

class TextureCache {

	constructor( renderer, key ) {

		this.key = key;
		this.renderer = renderer;
		this.texture = null;
		this.hash = null;

		// half float, since 8 bit linear data truncates dark colors (0x080808 becomes black)
		const colorTex = new DataTexture( toHalfFloatArray( [ 1, 1, 1, 1 ] ), 1, 1 );
		colorTex.type = HalfFloatType;
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

			colorTex.image.data.set( toHalfFloatArray( [ _color.r, _color.g, _color.b, clearAlpha ] ) );

			value = colorTex;
			hash = colorTex.image.data.join();
			colorTex.needsUpdate = hash !== this.hash;

		} else if ( value.isColor ) {

			colorTex.image.data.set( toHalfFloatArray( [ value.r, value.g, value.b, 1 ] ) );

			value = colorTex;
			hash = colorTex.image.data.join();
			colorTex.needsUpdate = hash !== this.hash;

		} else if ( value.isCubeTexture ) {

			hash = null;
			value = new CubeToEquirectGenerator( renderer ).generate( value );

		} else if ( value.isRenderTargetTexture ) {

			// rendering to a render target changes neither its uuid nor its version, so its contents are copied on
			// every update, which also keeps them from changing under the render
			hash = null;

			// "dataReady" set to false allocates the texture on the GPU without uploading any data, since it has none
			const { width, height } = value.image;
			const copy = new DataTexture( null, width, height, RGBAFormat, value.type );
			copy.colorSpace = value.colorSpace;
			copy.minFilter = LinearFilter;
			copy.magFilter = LinearFilter;
			copy.source.dataReady = false;
			copy.needsUpdate = true;

			renderer.copyTextureToTexture( value, copy );
			value = copy;

		} else {

			// hash the scene's texture rather than the clone, whose uuid is new on every call, so an
			// unchanged texture isn't cloned and re-processed each time the environment is updated
			hash = value.uuid + '_' + value.version;
			if ( hash !== this.hash ) {

				// a nearest filtered texture gets no sampler from TSL, which the equirect sampling
				// needs, so the copy is always filtered
				value = value.clone();
				value.minFilter = LinearFilter;
				value.magFilter = LinearFilter;

			}

		}

		// a texture swapped in is always the cache's own, never the scene's
		const needsUpdate = hash === null || hash !== this.hash;
		if ( needsUpdate ) {

			// an equirect map wraps around horizontally and is clamped at the poles
			value.wrapS = RepeatWrapping;
			value.wrapT = ClampToEdgeWrapping;

			this.texture?.dispose();
			this.texture = value;
			this.hash = hash;

		}

		return needsUpdate;

	}

}

// WebGPUPathTracer Event Definitions

/**
 * Fired once every pixel has reached `maxSamples` and an attached denoiser has finished. Fires
 * again after a reset, or after `maxSamples` is raised, once the render has caught up.
 * @event WebGPUPathTracer#complete
 */

/**
 * Fired as the render advances. `stage` is "building", "compiling", "rendering" or "denoising", and
 * `progress` is the fraction of it done, or null when unknown. "rendering" also gives the sample
 * counts as `samples`, reported a few times a second.
 * @event WebGPUPathTracer#progress
 */

/**
 * Progressive path tracer running on WebGPU. Call {@link WebGPUPathTracer#setScene} once,
 * then {@link WebGPUPathTracer#renderSample} every frame to accumulate samples into the canvas.
 *
 * The scene is captured when `setScene` is called, so changes to geometry, materials, lights, or
 * the environment afterward require the matching `update*` function. Any change that invalidates
 * the accumulated image restarts it.
 */
export class WebGPUPathTracer extends EventDispatcher {

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
		this.reset();

	}

	/**
	 * Number of path steps dispatched per {@link WebGPUPathTracer#renderSample} call,
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
	 * GPU time in milliseconds of a recent {@link WebGPUPathTracer#renderSample} call. Only measured
	 * when the renderer is created with `trackTimestamp: true`.
	 * @type {number}
	 * @readonly
	 */
	get frameTime() {

		return this._pathTracer.timing.frameTime;

	}

	/**
	 * Maximum number of alpha tested surfaces a ray can pass through. Counted separately from
	 * {@link WebGPUPathTracer#maxBounces} so foliage and cutouts cannot exhaust the bounce budget.
	 * @type {number}
	 * @default 15
	 */
	get maxTransparentBounces() {

		return this._pathTracer.maxTransparentBounces;

	}

	set maxTransparentBounces( v ) {

		this._pathTracer.maxTransparentBounces = v;
		this.reset();

	}

	/**
	 * Maximum number of scatter events a path can take inside a subsurface scattering volume. Counted
	 * separately from {@link WebGPUPathTracer#maxBounces}. Paths that reach it end, darkening dense volumes.
	 * @type {number}
	 * @default 256
	 */
	get maxSubsurfaceBounces() {

		return this._pathTracer.maxSubsurfaceBounces;

	}

	set maxSubsurfaceBounces( v ) {

		this._pathTracer.maxSubsurfaceBounces = v;
		this.reset();

	}

	/**
	 * Maximum number of times a path continues after scattering in fog. Light is still sampled at the
	 * scatter that reaches it, so 0 renders single scattering, as Cycles' volume bounces do. Fog scatters
	 * also count toward {@link WebGPUPathTracer#maxBounces}.
	 * @type {number}
	 * @default 0
	 */
	get maxFogBounces() {

		return this._pathTracer.maxFogBounces;

	}

	set maxFogBounces( v ) {

		this._pathTracer.maxFogBounces = v;
		this.reset();

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
		// render. The accumulated samples are still valid, but the pixels finished need measuring again
		this._denoiser?.reset();
		this._lastSampleCounts.finished = 0;

	}

	/**
	 * Whether every pixel has reached {@link WebGPUPathTracer#maxSamples} and an attached denoiser
	 * has finished, as of the last measurement. Always false while rendering indefinitely.
	 * @type {boolean}
	 */
	get complete() {

		const denoiser = this._denoiser;
		return this._lastSampleCounts.finished >= 1 && ( ! denoiser || denoiser.complete );

	}

	/**
	 * Measures the per pixel sample counts. Use `finished` for convergence checks and `avg` to display.
	 * @returns {Promise<SampleCounts>}
	 * @note The counts are reduced on the GPU and read back, so only call this when the numbers are needed.
	 */
	async getSampleCountsAsync() {

		const pathTracer = this._pathTracer;

		// written in place. reset swaps in a new object so a late measurement can't overwrite it.
		const counts = this._lastSampleCounts;
		const measured = await pathTracer.getSampleCountsAsync();

		counts.min = measured.min;
		counts.max = measured.max;
		counts.avg = measured.avg;
		counts.finished = measured.finished;

		// averaged over the time spent rendering
		counts.renderTime = this.getRenderTime();
		counts.elapsedTime = Math.max( this._resetTime, 0 );
		counts.samplesPerSecond = counts.renderTime > 0 ? 1000 * counts.avg / counts.renderTime : 0;

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
	 * Whether the kernels are compiling, such as after the scene or material changes. Nothing new
	 * renders until they finish and the canvas keeps the last frame, so an app may draw its own
	 * preview in the meantime.
	 * @type {boolean}
	 * @readonly
	 */
	get compiling() {

		return this._pathTracer.compiling;

	}

	/**
	 * The atlas every scene texture is packed into for the kernels to sample.
	 * @type {AtlasTexture}
	 * @readonly
	 */
	get textureAtlas() {

		return this._shadingModel.textureAtlas;

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
		this._timingCount = 0;
		this._pathTracer.setBVHData( this._bvhData );
		this._pathTracer.setLightsInfo( this._lightsInfo );
		this._pathTracer.setBackgroundInfo( this._backgroundInfo );
		this._pathTracer.setShadingModel( this._shadingModel );
		this._pathTracer.setRandom( this._random );
		this._pathTracer.setMultipleImportanceSampling( this.multipleImportanceSampling );
		this._pathTracer.setTransmissiveBackground( this._transmissiveBackground );
		this._pathTracer.setFilterGlossy( this._filterGlossyFactor );
		this._pathTracer.setClamping( this._clampDirect, this._clampIndirect );
		this._pathTracer.setAccumulateAux( Boolean( this._denoiser && this._denoiser.useAuxiliaryBuffers ) );
		this.setCamera( this.camera );
		this.reset();

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	constructor( renderer ) {

		super();

		// members
		this._renderer = renderer;
		this._timer = new Timer();

		// leaves out the time the page spends hidden
		if ( typeof document !== 'undefined' ) {

			this._timer.connect( document );

		}

		this._environmentCache = new TextureCache( renderer, 'environment' );
		this._backgroundCache = new TextureCache( renderer, 'background' );

		this._resetTime = - 1;
		this._fadeState = 0;
		this._lastSampleCounts = { min: 0, max: 0, avg: 0, finished: 0, samplesPerSecond: 0, renderTime: 0, elapsedTime: 0 };
		this._size = new Vector2();

		// the time spent rendering, and a watchdog that notices when the app stops calling "renderSample"
		this._renderTime = 0;
		this._renderedLastCall = false;
		this._renderWatchdog = new FrameWatchdog( () => {

			// count the last sample up to the frame it would have been followed by another call
			this._timer.update();
			if ( this._renderedLastCall ) {

				this._renderTime += 1000 * this._timer.getDelta();

			}

			this._renderedLastCall = false;

		} );

		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// adaptive frame budget and preview state
		this._timingCount = 0;
		this._frameTimeTotal = 0;
		this._frameTimeCount = 0;
		this._warnedTimestamps = false;

		// the budget from before the first pixels finished, restored on reset. The last few pixels render
		// quickly and inflate the budget
		this._fullFrameBudget = null;

		// a copy of the last low res preview, laid out like the output target
		this._lowResTarget = createOutputTarget( 'Low Res Preview' );

		// the lights, environment and background, which the backends sample
		this._lightsInfo = new LightsInfoNode();
		this._backgroundInfo = new EquirectBackgroundInfo();

		this._pathTracer = new WaveFrontPathTracer( renderer );
		this._pathTracer.setLightsInfo( this._lightsInfo );
		this._pathTracer.setBackgroundInfo( this._backgroundInfo );

		// optional post passes, attached with "setDenoiser" / "setUpscaler"
		this._denoiser = null;
		this._upscaler = null;

		// the RGBA input of the denoiser and upscaler
		this._inputTarget = null;

		// the attached denoiser's progress events are forwarded
		this._onDenoiserProgress = e => this.dispatchEvent( { type: 'progress', stage: 'denoising', progress: e.progress } );

		// the current stage, building until the first scene is set. Only the latest "setScene" call sets its scene
		this._stage = STAGE_BUILDING;
		this._sceneAbortController = new AbortController();

		// options

		/**
		 * Average samples per pixel the full resolution render must reach before it is faded in.
		 * @type {number}
		 * @default 1
		 */
		this.minSamples = 1;

		/**
		 * Milliseconds to show the low resolution preview for after a reset.
		 * @type {number}
		 * @default 16
		 */
		this.renderDelay = 16;

		/**
		 * Milliseconds taken to cross fade from the preview to the full render.
		 * @type {number}
		 * @default 250
		 */
		this.fadeDuration = 250;

		/**
		 * Whether to render a low resolution preview while the camera is moving, sized to the pixels a frame of
		 * {@link WebGPUPathTracer#frameBudget} can render.
		 * @type {boolean}
		 * @default true
		 */
		this.dynamicLowRes = true;

		/**
		 * Whether {@link WebGPUPathTracer#frameBudget} is adjusted to keep each
		 * {@link WebGPUPathTracer#renderSample} call near {@link WebGPUPathTracer#targetFrameTime} of
		 * GPU time. Requires a renderer created with `trackTimestamp: true`.
		 * @type {boolean}
		 * @default true
		 */
		this.adaptiveFrameBudget = true;

		/**
		 * GPU time in milliseconds per frame targeted by {@link WebGPUPathTracer#adaptiveFrameBudget}.
		 * @type {number}
		 * @default 16
		 */
		this.targetFrameTime = 16;

		/**
		 * Resolution the path tracer renders at, as a fraction of the canvas size. Lowering it
		 * converges faster at the cost of detail, and pairs with an upscaler.
		 * @type {number}
		 * @default 1
		 */
		this.renderScale = 1;

		/**
		 * Whether the render is interpolated when drawn to a canvas of a different size, such as with a
		 * {@link WebGPUPathTracer#renderScale} below one or during the low resolution preview. Set to `false` to show
		 * each rendered pixel as is. Not used by an upscaler.
		 * @type {boolean}
		 * @default true
		 */
		this.interpolateDisplay = true;

		/**
		 * Whether to track the canvas size automatically. Set to `false` to drive the render
		 * size with {@link WebGPUPathTracer#setSize}.
		 * @type {boolean}
		 * @default true
		 */
		this.synchronizeRenderSize = true;

		/**
		 * Whether {@link WebGPUPathTracer#renderSample} draws the result to the current render
		 * target, the canvas by default. Set to `false` to only accumulate, as when baking to a
		 * texture written with {@link WebGPUPathTracer#renderTo}.
		 * @type {boolean}
		 * @default true
		 */
		this.renderToCanvas = true;

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
		 * @type {Object}
		 * @private
		 */
		this._random = RANDOM_SOBOL;

		/**
		 * Shading model the kernels evaluate surfaces with.
		 * @type {ShadingModel}
		 * @private
		 */
		this._shadingModel = new GLTFShadingModel();

		// default camera ray generation ( perspective / orthographic ), assigned onto each bvh compute
		// data's fns so the kernels can proxy it
		this._cameraWorldMatrix = uniform( new Matrix4() );
		this._cameraProjectionInverse = uniform( new Matrix4() );
		this._cameraRayFnHandle = null;
		this._BVHWorker = null;

		// the render time of the last check for the render having stopped
		this._lastCompleteCheck = 0;
		this._wasComplete = false;

		this.setShadingModel( this._shadingModel );
		this.setRandom( this._random );

		// an empty scene and a basic camera until "setScene" resolves, which nothing renders before
		this.scene = new Scene();
		this._bvhData = new PathtracerBVHComputeData( this.scene, this._shadingModel );
		this._bvhData.update();
		this._pathTracer.setBVHData( this._bvhData );
		this.setCamera( new PerspectiveCamera() );

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
	 * Settings live on the instance. Pass null to remove it. The render restarts when the auxiliary
	 * buffers it needs are added or dropped.
	 *
	 * @param {OIDNDenoiser|null} denoiser
	 */
	setDenoiser( denoiser ) {

		// a detached instance stops receiving resets, so clear it rather than let it hold a
		// result from a camera position that has since moved
		this._denoiser?.reset();
		this._denoiser?.removeEventListener( 'progress', this._onDenoiserProgress );
		this._denoiser = denoiser;

		if ( denoiser ) {

			denoiser.init( this._renderer );
			denoiser.addEventListener( 'progress', this._onDenoiserProgress );

		}

		this._pathTracer.setAccumulateAux( Boolean( denoiser && denoiser.useAuxiliaryBuffers ) );
		this._updateInputTarget();
		this.reset();

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

		this._updateInputTarget();

	}

	// allocated only while a denoiser or upscaler is attached
	_updateInputTarget() {

		const needed = Boolean( this._denoiser || this._upscaler );
		if ( needed && ! this._inputTarget ) {

			this._inputTarget = new RenderTarget( 1, 1, { type: HalfFloatType, depthBuffer: false } );

		} else if ( ! needed && this._inputTarget ) {

			this._inputTarget.dispose();
			this._inputTarget = null;

		}

	}

	// upscales the denoised result when available
	_upscale( width, height ) {

		const texture = this._denoiser?.texture ?? this._renderInput();
		this._upscaler.upscale( texture, this.camera, width, height );

	}

	// fills the denoiser and upscaler input
	_renderInput() {

		this.renderTo( this._inputTarget, { output: 'accumulated' } );
		return this._inputTarget.texture;

	}

	/**
	 * Captures the scene and camera and builds the acceleration structures the kernels trace
	 * against. Call this once, then use the `update*` functions for later changes. Rendering pauses
	 * on the last frame until the scene is ready.
	 *
	 * @param {Scene} scene
	 * @param {Camera} camera
	 * @returns {Promise<void>} Resolves once the scene renders. A later call replaces a scene still being set.
	 * @note Missing geometry BVHs are built in the workers set with {@link WebGPUPathTracer#setBVHWorker}, or else on
	 *   the main thread, which blocks for large scenes. Skinned mesh BVHs are always built on the main thread.
	 */
	async setScene( scene, camera ) {

		// replace a scene still being set. The BVHs already built for it are kept on their geometry
		this._sceneAbortController.abort();
		this._sceneAbortController = new AbortController();

		const { signal } = this._sceneAbortController;

		// stop rendering the previous scene while the next one builds, keeping the last frame. The denoiser runs
		// its tiles on its own schedule, so it's reset separately
		this._setStage( STAGE_BUILDING );
		this._denoiser?.reset();

		try {

			const missingBVHs = getMissingBVHs( scene );
			if ( this._BVHWorker && missingBVHs.size > 0 ) {

				await this._buildBVHsInWorkers( missingBVHs, signal );
				if ( signal.aborted ) {

					return;

				}

			} else {

				missingBVHs.forEach( ( { geometry, options, setBVH } ) => {

					setBVH( new MeshBVH( geometry, options ) );

				} );

			}

			await this._setBuiltScene( scene, camera, signal );

		} catch ( error ) {

			// render the previous scene again
			if ( ! signal.aborted ) {

				this._setStage( STAGE_COMPILING );

			}

			throw error;

		}

	}

	/**
	 * Sets the worker class {@link WebGPUPathTracer#setScene} builds the mesh geometry BVHs with, such as
	 * `GenerateMeshBVHWorker` from three-mesh-bvh, so the page is not blocked. Several are created and
	 * disposed per call so geometries build in parallel. They're built on the main thread without one.
	 *
	 * @param {Function|null} WorkerConstructor
	 */
	setBVHWorker( WorkerConstructor ) {

		this._BVHWorker = WorkerConstructor;

	}

	// builds the BVHs from "getMissingBVHs" in workers, resolving early when aborted
	async _buildBVHsInWorkers( missingBVHs, signal ) {

		// each worker runs one job at a time so they pull from a shared queue
		const queue = [ ...missingBVHs.values() ];
		const workers = [];
		for ( let i = 0, l = Math.min( MAX_BVH_WORKERS, queue.length ); i < l; i ++ ) {

			workers.push( new this._BVHWorker() );

		}

		// build progress, weighted by triangle count
		const totalTriangles = queue.reduce( ( sum, job ) => sum + job.triangles, 0 );
		let builtTriangles = 0;

		const build = async worker => {

			while ( queue.length > 0 ) {

				const { geometry, options, triangles, setBVH } = queue.shift();
				let reported = 0;
				const onProgress = progress => {

					builtTriangles += ( progress - reported ) * triangles;
					reported = progress;
					this.dispatchEvent( { type: 'progress', stage: 'building', progress: builtTriangles / totalTriangles } );

				};

				setBVH( await worker.generate( geometry, { ...options, onProgress } ) );
				onProgress( 1 );

			}

		};

		// TODO: a disposed worker's build never settles. Remove this once fixed in three-mesh-bvh#1026
		const aborted = new Promise( resolve => signal.addEventListener( 'abort', resolve ) );
		try {

			await Promise.race( [ aborted, Promise.all( workers.map( build ) ) ] );

		} finally {

			queue.length = 0;
			workers.forEach( worker => worker.dispose() );

		}

	}

	// sets the scene once its geometry BVHs are built, unless aborted
	async _setBuiltScene( scene, camera, signal ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

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

			}

		} );

		// the materials are written first since the bvh data writes their indices with the transforms
		const { _shadingModel: shadingModel } = this;
		shadingModel.updateMaterials( scene );

		// Build TLAS and compute functions
		const bvhData = new PathtracerBVHComputeData( scene, shadingModel );
		await bvhData.update();

		if ( signal.aborted ) {

			bvhData.dispose();
			return;

		}

		this._setStage( STAGE_COMPILING );
		shadingModel.updateTextures( this._renderer );

		if ( this._bvhData ) {

			this._bvhData.dispose();

		}

		this.scene = scene;
		this._bvhData = bvhData;
		this._pathTracer.setBVHData( bvhData );
		this.setCamera( camera );
		this.updateEnvironment();
		this.updateLights();

	}

	/**
	 * @returns {ShadingModel}
	 * @private
	 */
	getShadingModel() {

		return this._shadingModel;

	}

	/**
	 * Replaces the shading model and recompiles the kernels.
	 *
	 * @param {ShadingModel} shadingModel
	 * @private
	 */
	setShadingModel( shadingModel ) {

		this._shadingModel = shadingModel;
		shadingModel.updateFunctions();

		// the shading model writes the materials, so rewrite them in its struct
		const { _bvhData, _renderer, scene } = this;
		if ( _bvhData ) {

			shadingModel.updateMaterials( scene );
			shadingModel.updateTextures( _renderer );
			_bvhData.setShadingModel( shadingModel );

		}

		this._pathTracer.setShadingModel( shadingModel );
		this.reset();

	}

	/**
	 * Replaces the random number generator and recompiles the kernels.
	 *
	 * @param {Object} random - One of the Random Strategies constants, such as `RANDOM_BLUE_DITHER`.
	 */
	setRandom( random ) {

		this._random = random;
		this._pathTracer.setRandom( random );
		this.reset();

	}

	/**
	 * Replaces the camera the rays are generated from. Cameras with a `getCameraRayFn`, such as
	 * `PhysicalCamera` and `EquirectCamera`, provide their own ray generation, and optionally
	 * `getRayOriginBounds( box, boundsToWorld )`, the bounds of where their rays start in camera space.
	 * Its WGSL `getCameraRay( pixel: vec2u, sample: vec2f, resolution: vec2f, ray ) -> bool` receives the
	 * pixel to render and a `[ 0, 1 )` random sample for the point within it, and returns false to skip
	 * the pixel.
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
			const { _cameraWorldMatrix, _cameraProjectionInverse } = this;
			this._cameraRayFnHandle = {
				update: () => {

					camera.coordinateSystem = WebGPUCoordinateSystem;
					camera.updateMatrixWorld();

					if ( camera.isOrthographicCamera || camera.isPerspectiveCamera ) {

						camera.updateProjectionMatrix();

					}

					_cameraWorldMatrix.value.copy( camera.matrixWorld );
					_cameraProjectionInverse.value.copy( camera.projectionMatrixInverse );
					return false;

				},
				fn: wgslTagFn/* wgsl */`
					fn getCameraRay( pixel: vec2u, sample: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

						let uv = ( vec2f( pixel ) + sample ) / resolution;
						let ndc = uv * 2.0 - vec2f( 1.0 );
						*ray = ${ ndcToCameraRay }( ndc, ${ _cameraWorldMatrix }, ${ _cameraProjectionInverse } );
						return true;

					}
				`,
				getRayOriginBounds: camera.isPerspectiveCamera || camera.isOrthographicCamera ? ( target, boundsToWorld ) => {

					boundsToWorld.copy( camera.matrixWorld );
					return expandByNearPlane( camera, target );

				} : null,
			};

		}

		this._bvhData.fns.getCameraRay = this._cameraRayFnHandle.fn;
		this._cameraRayFnHandle.update();
		this._updateCameraInVolume();
		this._pathTracer.rebuild();
		this.reset();

	}

	/**
	 * Re-reads the material properties and textures from the scene. Call after changing any
	 * material.
	 */
	updateMaterials() {

		const { _bvhData, _renderer, _shadingModel, scene } = this;
		_shadingModel.updateMaterials( scene );
		_bvhData.updateMaterialIndices();

		// the kernels size the texture info when they're built, so a new texture count needs a rebuild
		if ( _shadingModel.updateTextures( _renderer ) ) {

			this._pathTracer.rebuild();

		}

		this._updateCameraInVolume();
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
		this._updateCameraInVolume();
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

		this._updateCameraInVolume();
		this.reset();

	}

	// Sets whether camera rays may start inside a volume, as in Cycles' "is_inside_volume"
	_updateCameraInVolume() {

		const { _cameraRayFnHandle, _bvhData, _shadingModel, _pathTracer, scene } = this;

		// cameras without origin bounds always count as inside
		const hasOriginBounds = Boolean( _cameraRayFnHandle.getRayOriginBounds );
		if ( hasOriginBounds ) {

			_cameraRayFnHandle.getRayOriginBounds( _originBounds.makeEmpty(), _originToWorld );

		}

		let cameraInVolume = false;
		scene.traverse( child => {

			if ( cameraInVolume || ! child.isMesh ) {

				return;

			}

			const materials = Array.isArray( child.material ) ? child.material : [ child.material ];
			if ( materials.some( material => _shadingModel.isVolumeMaterial( material ) ) ) {

				cameraInVolume = ! hasOriginBounds || _bvhData.boxIntersectsMesh( _originBounds, _originToWorld, child );

			}

		} );

		_pathTracer.cameraInVolume = cameraInVolume;

	}

	/**
	 * Re-reads `scene.environment` and `scene.background`, along with their intensity, rotation,
	 * and blur.
	 */
	updateEnvironment() {

		const {
			_lightsInfo,
			_backgroundInfo,
			scene,

			_environmentCache,
			_backgroundCache,
		} = this;

		// update the texture if they've changed. The background info only owns its default map, which the first
		// scene texture replaces
		const { envInfo } = _lightsInfo;
		if ( _environmentCache.setFromScene( scene ) ) {

			envInfo.updateFrom( this._renderer, _environmentCache.texture );

		}

		if ( _backgroundCache.setFromScene( scene ) ) {

			_backgroundInfo.dispose();
			_backgroundInfo.map = _backgroundCache.texture;

		}

		// update the params always since they're cheap
		_rotationMatrix.makeRotationFromEuler( scene.environmentRotation ).invert();
		envInfo.rotationNode.value.setFromMatrix4( _rotationMatrix );
		envInfo.intensityNode.value = scene.environmentIntensity;

		_rotationMatrix.makeRotationFromEuler( scene.backgroundRotation ).invert();
		_backgroundInfo.rotationNode.value.copy( _rotationMatrix );
		_backgroundInfo.intensity = scene.backgroundIntensity;
		_backgroundInfo.blur = scene.backgroundBlurriness;

		this.reset();

	}

	/**
	 * Re-collects the lights in the scene. Call after adding, removing, or changing one.
	 */
	updateLights() {

		const { _pathTracer, _lightsInfo, _renderer, scene } = this;

		// a new number of ies profiles changes the kernels
		if ( _lightsInfo.updateFrom( _renderer, getLights( scene ) ) ) {

			_pathTracer.rebuild();

		}

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

			// cameras can depend on the size
			if ( this._cameraRayFnHandle ) {

				this.updateCamera();

			} else {

				this.reset();

			}

		}

	}

	/**
	 * Discards the accumulated image and starts over. The `update*` functions call this for you.
	 */
	reset() {

		this._pathTracer.reset();
		this._denoiser?.reset();
		this._resetTime = - 1;
		this._renderTime = 0;
		this._renderedLastCall = false;
		this._fadeState = 0;
		this._timer.update();

		// a fresh object rather than a clear, so measurements still in flight detach
		this._lastSampleCounts = { min: 0, max: 0, avg: 0, finished: 0, samplesPerSecond: 0, renderTime: 0, elapsedTime: 0 };
		this._lastCompleteCheck = 0;
		this._wasComplete = false;

		// undo the adaptation's last changes, unless the app has since taken over the budget
		if ( this.adaptiveFrameBudget && this._fullFrameBudget !== null ) {

			this.frameBudget = this._fullFrameBudget;

		}

		this._fullFrameBudget = null;

	}

	// Sets the stage, reporting when each one starts
	_setStage( stage ) {

		if ( this._stage === stage ) {

			return;

		}

		this._stage = stage;
		if ( stage === STAGE_BUILDING ) {

			this.dispatchEvent( { type: 'progress', stage: 'building', progress: 0 } );

		} else if ( stage === STAGE_COMPILING ) {

			this.dispatchEvent( { type: 'progress', stage: 'compiling', progress: null } );

		} else {

			this._dispatchRenderProgress( { min: 0, max: 0, avg: 0, finished: 0, samplesPerSecond: 0, renderTime: 0, elapsedTime: 0 } );

		}

	}

	// Measures the sample counts and reports them
	_measureSamples() {

		const counts = this._lastSampleCounts;
		this.getSampleCountsAsync().then( samples => {

			// skip if the render was reset or a new scene started building meanwhile
			if ( counts === this._lastSampleCounts && this._stage === STAGE_RENDERING ) {

				// save the adaptive budget once the first pixels finish, to undo the adaptation on reset
				const { maxSamples } = this;
				if ( this.adaptiveFrameBudget && this._fullFrameBudget === null && maxSamples > 0 && samples.max >= maxSamples ) {

					this._fullFrameBudget = this.frameBudget;

				}

				this._dispatchRenderProgress( samples );

			}

		} );

	}

	_dispatchRenderProgress( samples ) {

		const { maxSamples } = this;
		const progress = maxSamples > 0 ? Math.min( samples.avg / maxSamples, 1 ) : null;
		this.dispatchEvent( { type: 'progress', stage: 'rendering', progress, samples } );

	}

	// Adapts the frame budget to the tracer's latest gpu time measurement
	_readTiming() {

		const { timing } = this._pathTracer;
		const { trackTimestamp } = this._renderer.backend;
		if ( this.adaptiveFrameBudget && ! trackTimestamp && ! this._warnedTimestamps ) {

			console.warn( 'WebGPUPathTracer: "adaptiveFrameBudget" needs timestamp queries. Create the renderer with "trackTimestamp: true" on a device that supports them.' );
			this._warnedTimestamps = true;

		}

		if ( timing.count === this._timingCount ) {

			return;

		}

		this._timingCount = timing.count;

		// a measurement from before the budget changed doesn't describe the current one
		const { frameBudget } = timing;
		if ( ! this.adaptiveFrameBudget || frameBudget !== this.frameBudget ) {

			this._frameTimeTotal = 0;
			this._frameTimeCount = 0;
			return;

		}

		this._frameTimeTotal += timing.frameTime;
		this._frameTimeCount ++;
		if ( this._frameTimeCount < BUDGET_WINDOW ) {

			return;

		}

		const { targetFrameTime } = this;
		const average = this._frameTimeTotal / this._frameTimeCount;
		this._frameTimeTotal = 0;
		this._frameTimeCount = 0;

		// leave the budget alone while it's close enough to the target
		const ratio = average / targetFrameTime;
		if ( ratio < BUDGET_CHANGE_THRESHOLD && ratio > 1 / BUDGET_CHANGE_THRESHOLD ) {

			return;

		}

		// scale the budget to land the average on the target
		const next = frameBudget * targetFrameTime / average;
		const stepped = MathUtils.clamp( next, frameBudget / BUDGET_MAX_STEP, frameBudget * BUDGET_MAX_STEP );
		this.frameBudget = Math.max( Math.round( stepped ), MIN_FRAME_BUDGET );

	}

	/**
	 * Accumulates one round of samples and presents the result to the canvas. Call once per frame.
	 */
	renderSample() {

		const renderer = this._renderer;
		const size = this._size;
		const pathTracer = this._pathTracer;
		const lowResTarget = this._lowResTarget;
		const timer = this._timer;
		const {
			renderDelay,
			dynamicLowRes,
			synchronizeRenderSize,
			renderScale,
			minSamples,
			maxSamples,
		} = this;

		timer.update();
		this._renderWatchdog.markCalled();

		if ( ! this._renderer._initialized ) {

			return;

		}

		if ( ! this._shadingModel.initialized ) {

			this._shadingModel.init( renderer );
			this._shadingModel.initialized = true;

		}

		// compile the kernels even while the render is delayed
		if ( ! this.pause && this._stage > STAGE_BUILDING ) {

			pathTracer.compileKernels();
			this._setStage( pathTracer.compiling ? STAGE_COMPILING : STAGE_RENDERING );

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

			// the most pixels a preview frame can render within the frame budget, checked every frame since the budget
			// adapts. Pixels past it are never reached by the wavefront in a preview
			const scale = Math.min( Math.sqrt( pathTracer.getPreviewPixelBudget() / ( width * height ) ), 1 );
			width = Math.max( 1, Math.floor( scale * width ) );
			height = Math.max( 1, Math.floor( scale * height ) );

		}

		// set the size if necessary
		pathTracer.getSize( _resolution );

		// copy the low res content when transitioning to the full resolution view so we can fade from
		// it, including when the preview was already full size and nothing is resized
		if ( ! lowResMode && pathTracer.lowResMode && dynamicLowRes ) {

			// copy every layer, not only the first
			const { depth } = pathTracer.outputTarget;
			lowResTarget.setSize( _resolution.x, _resolution.y, depth );
			_outputRegion.min.set( 0, 0, 0 );
			_outputRegion.max.set( _resolution.x, _resolution.y, depth );
			renderer.copyTextureToTexture( pathTracer.outputTarget, lowResTarget, _outputRegion );

		}

		if ( _resolution.x !== width || _resolution.y !== height ) {

			pathTracer.setSize( width, height );

		}

		// update the samples, stopping once every pixel has reached "maxSamples"
		const samplesComplete = this._lastSampleCounts.finished >= 1;
		let rendered = false;
		if ( ! this.pause && ! samplesComplete && this._stage === STAGE_RENDERING && ( ! lowResMode || ( lowResMode && dynamicLowRes ) ) ) {

			pathTracer.lowResMode = lowResMode;
			pathTracer.stableNoise = this.stableNoise;
			pathTracer.update();
			this._readTiming();
			rendered = true;

		}

		// count the time since a call that rendered samples
		if ( this._renderedLastCall ) {

			this._renderTime += delta;

		}

		this._renderedLastCall = rendered;

		// nothing renders while the next scene's BVHs build or the kernels compile, so restart the preview timer and
		// keep the last frame
		// TODO: decide what to display meanwhile - the last frame goes stale when the camera moves, and a
		// rasterized preview compiles its own materials
		if ( this._stage < STAGE_RENDERING ) {

			this._resetTime = - 1;
			return;

		}

		const denoiser = this._denoiser;
		const upscaler = this._upscaler;

		// the denoiser runs once the render stops, so an uncapped render never denoises
		// TODO: this only needs to know whether the render stopped, but measures the per pixel
		// counts every frame. A count of the camera rays dispatched would answer it in one value
		const awaitingDenoise = Boolean( denoiser ) && ! denoiser.complete && ! denoiser.running && maxSamples > 0;

		// Gate on the average pixel. Measuring is expensive so it stops once faded in, and
		// the check reads the last measurement rather than waiting on this one.
		if ( ! lowResMode ) {

			// the counts can't change once every pixel has finished, so measuring stops
			if ( ! samplesComplete && this._fadeState < 1 && minSamples > 0 ) {

				this._measureSamples();

			} else if ( ! samplesComplete && this._resetTime - this._lastCompleteCheck >= COMPLETE_CHECK_INTERVAL ) {

				// the readback stalls the gpu pipeline, so the render only measures a few times a second.
				// The "progress" and "complete" events and the denoiser key off it
				this._lastCompleteCheck = this._resetTime;
				this._measureSamples();

			}

			if ( this._lastSampleCounts.avg >= minSamples ) {

				this._fadeState += delta / this.fadeDuration;
				this._fadeState = Math.min( 1.0, this._fadeState ) || 1.0;

			}

		}

		// the low res preview is replaced moments later, so it is neither denoised nor upscaled
		if ( ! lowResMode ) {

			if ( awaitingDenoise && samplesComplete ) {

				denoiser.update( this._renderInput(), pathTracer.auxTarget );

			}

			if ( upscaler ) {

				renderer.getDrawingBufferSize( _drawingBufferSize );
				this._upscale( _drawingBufferSize.x, _drawingBufferSize.y );

				// the pass above binds its own targets
				renderer.setRenderTarget( originalTarget );

			}

		}

		// draws to the current render target without resizing it
		if ( this.renderToCanvas ) {

			this._drawOutput( 'beauty' );

		}

		// reset the renderer
		renderer.autoClear = originalAutoClear;
		renderer.setRenderTarget( originalTarget );

		// fires once the render, and the denoiser if one is attached, has finished and the result is drawn
		const complete = this.complete;
		if ( complete && ! this._wasComplete ) {

			this.dispatchEvent( { type: 'complete' } );

		}

		this._wasComplete = complete;

	}

	/**
	 * Draws the render into a render target, or the canvas when `null`. "beauty" is the image as
	 * {@link WebGPUPathTracer#renderSample} presents it, and "accumulated" is the averaged samples alone.
	 * Targets are resized to the output's size unless "resize" is false, in which case an upscaler
	 * upscales to the target's size. Targets receive linear values, clamped in half float targets.
	 *
	 * @param {RenderTarget|null} [target]
	 * @param {Object} [options]
	 * @param {'beauty'|'accumulated'} [options.output]
	 * @param {boolean} [options.resize]
	 * @note "beauty" blends, so it needs a blendable target format such as half float.
	 */
	renderTo( target = null, options = {} ) {

		const { output = 'beauty', resize = true } = options;
		const renderer = this._renderer;
		const originalTarget = renderer.getRenderTarget();
		const upscaled = output === 'beauty' && this._upscaler;

		if ( target !== null && resize ) {

			const size = upscaled ? renderer.getDrawingBufferSize( _drawingBufferSize ) : this._size;
			target.setSize( size.x, size.y );

		} else if ( target !== null && upscaled && ! this.lowResMode ) {

			this._upscale( target.width, target.height );

		}

		renderer.setRenderTarget( target );
		this._drawOutput( output );
		renderer.setRenderTarget( originalTarget );

	}

	// draws an output into the current render target
	_drawOutput( output ) {

		const renderer = this._renderer;
		const quad = this._blitQuad;
		const material = quad.material;
		const originalAutoClear = renderer.autoClear;

		// the accumulated samples are written as is. Blending is disabled rather than "transparent", which forces an alpha of 1
		const beauty = output !== 'accumulated';
		material.blending = beauty ? NormalBlending : NoBlending;

		if ( beauty ) {

			// the upscaled or denoised result when available
			const { lowResMode, dynamicLowRes, minSamples } = this;
			const texture = lowResMode ? null : this._upscaler?.texture ?? this._denoiser?.texture ?? null;
			const opacity = lowResMode && dynamicLowRes ? 1.0 : this._fadeState;

			// the preview stays under the render until it fades in, and with no "minSamples" until every pixel has a sample
			const previewNeeded = this._fadeState < 1 || ( minSamples === 0 && this._lastSampleCounts.min < 1 );
			renderer.autoClear = dynamicLowRes ? true : opacity === 1.0;
			material.transition = dynamicLowRes ? opacity : 1.0;
			material.showPreview = dynamicLowRes && ! lowResMode && previewNeeded;
			material.opacity = dynamicLowRes ? 1.0 : opacity;
			material.texture = texture ?? this._pathTracer.outputTarget;

		} else {

			material.transition = 1.0;
			material.showPreview = false;
			material.opacity = 1.0;
			material.texture = this._pathTracer.outputTarget;

		}

		material.nearest = ! this.interpolateDisplay;
		material.fromTexture = this._lowResTarget;
		material.maxValue = renderer.getRenderTarget()?.texture.type === HalfFloatType ? 65504 : 0;
		quad.render( renderer );

		renderer.autoClear = originalAutoClear;

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

		// (re)build the quad if it hasn't been built or the bvh data or shading model has changed
		if ( this._debugBoundsQuad === undefined || this._debugBoundsData !== this._bvhData || this._debugBoundsShadingModel !== this._shadingModel ) {

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

		const { _bvhData: bvhData, _shadingModel: shadingModel } = this;
		const debugBounds = getDebugBoundsFunction( bvhData, shadingModel );

		const material = new MeshBasicNodeMaterial();
		material.colorNode = debugBounds( varying( uv() ) ).context( { bvhData, shadingModel } );

		if ( this._debugBoundsQuad === undefined ) {

			this._debugBoundsQuad = new FullScreenQuad( material );

		} else {

			this._debugBoundsQuad.material.dispose();
			this._debugBoundsQuad.material = material;

		}

		this._debugBoundsUniforms = debugBounds.uniforms;
		this._debugBoundsData = bvhData;
		this._debugBoundsShadingModel = shadingModel;

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
	 * Draws the albedo or normal auxiliary buffer accumulated for the denoiser, for checking what
	 * it is given. Nothing is drawn until a denoiser that uses them is attached.
	 *
	 * @param {'albedo'|'normal'} [buffer='albedo']
	 */
	renderAuxBuffer( buffer = 'albedo' ) {

		const renderer = this._renderer;
		const pathTracer = this._pathTracer;

		if ( ! renderer._initialized || ! pathTracer.auxTarget ) {

			return;

		}

		if ( ! this._auxDebugQuad ) {

			this._auxDebugQuad = new FullScreenQuad( new AuxDebugMaterial() );

		}

		const originalToneMapping = renderer.toneMapping;
		renderer.toneMapping = NoToneMapping;

		const quad = this._auxDebugQuad;
		quad.material.texture = pathTracer.auxTarget;
		quad.material.showNormal = buffer === 'normal';
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
		this._lightsInfo.dispose();
		this._shadingModel.dispose();
		this._environmentCache.dispose();
		this._backgroundCache.dispose();
		this._lowResTarget.dispose();
		this._inputTarget?.dispose();

		// FullScreenQuad.dispose only disposes the shared geometry, not the material
		this._blitQuad.dispose();
		this._blitQuad.material.dispose();
		this._atlasDebugQuad?.dispose();
		this._atlasDebugQuad?.material.dispose();
		this._sampleDensityQuad?.dispose();
		this._sampleDensityQuad?.material.dispose();
		this._auxDebugQuad?.dispose();
		this._auxDebugQuad?.material.dispose();

		if ( this._debugBoundsQuad !== undefined ) {

			this._debugBoundsQuad.dispose();
			this._debugBoundsQuad.material.dispose();

		}

		this._timer.dispose();
		this._renderWatchdog.dispose();

	}

	/**
	 * Milliseconds spent rendering samples since the last reset.
	 * @returns {number}
	 */
	getRenderTime() {

		return this._renderTime;

	}

}
