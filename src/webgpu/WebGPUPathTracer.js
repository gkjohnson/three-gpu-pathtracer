import { DataTexture, LinearFilter, Vector2, Scene, PerspectiveCamera, Color, NoToneMapping, FloatType, Timer, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
import { uv, varying } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { getDebugBoundsFunction } from './nodes/debugBounds.wgsl.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { PathtracerBVHComputeData } from './nodes/PathtracerBVHComputeData.js';
import { AtlasDebugMaterial } from './materials/debug/AtlasDebugMaterial.js';
import { setCommonAttributes } from '../core/utils/GeometryPreparationUtils.js';
import { GltfCompliantMaterial } from './materials/GltfCompliantMaterial.js';

const _resolution = new Vector2();
const _color = new Color();

export class WebGPUPathTracer {

	get bounces() {

		return this._pathTracer.bounces;

	}

	set bounces( v ) {

		this._pathTracer.bounces = v;
		this._pathTracer.reset();

	}

	get samples() {

		return this._pathTracer.samples;

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

	updateMaterials() {}

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
		this.setCamera( this.camera );
		this.updateEnvironment();

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._timer = new Timer();

		this._envColorTexture = new DataTexture( );
		this._envColorTexture.image.data = new Uint8Array( [ 255, 255, 255, 255 ] );
		this._envColorTexture.needsUpdate = true;
		this._envColorTexture.minFilter = LinearFilter;
		this._envColorTexture.magFilter = LinearFilter;

		this._backgroundColorTexture = new DataTexture( );
		this._backgroundColorTexture.image.data = new Uint8Array( [ 255, 255, 255, 255 ] );
		this._backgroundColorTexture.needsUpdate = true;
		this._backgroundColorTexture.minFilter = LinearFilter;
		this._backgroundColorTexture.magFilter = LinearFilter;

		this._resetTime = 0;
		this._fadeState = 0;
		this._size = new Vector2();
		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// avoid mipmap gen on copy, not always supported with float type
		this._lowResTarget = new StorageTexture( 1, 1 );
		this._lowResTarget.type = FloatType;
		this._lowResTarget.generateMipmaps = false;

		// options
		this.minSamples = 1;
		this.renderDelay = 500;
		this.fadeDuration = 500;
		this.dynamicLowRes = true;
		this.lowResScale = 0.25;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.generateMissingAttributes = true;
		this.commonAttributes = [ 'normal', 'tangent', 'color' ];
		this.stableNoise = false;
		this.pause = false;

		// WebGLPathTracer compatibility stubs (see getters above)
		// TOOD: implement these correctly
		this.multipleImportanceSampling = true;
		this.transmissiveBounces = 5;
		this.filterGlossyFactor = 0;

		this.material = new GltfCompliantMaterial();
		this._pathTracer = new WaveFrontPathTracer( renderer );

		// initialize the scene so it doesn't fail
		this.setMaterial( this.material );
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

					child.boundsTree = new SkinnedMeshBVH( child, { strategy: SAH, maxLeafSize: 5, indirect: true } );

				} else {

					child.boundsTree.refit();
					child.boundsTree.getBoundingBox( child.boundingBox );

				}

			} else if ( child.isMesh ) {

				if ( ! child.geometry.boundsTree ) {

					child.geometry.boundsTree = new MeshBVH( child.geometry, { strategy: SAH, maxLeafSize: 5 } );

				}

			}

		} );

		// Build TLAS and compute functions
		const bvhData = new PathtracerBVHComputeData( scene );
		bvhData.update();
		bvhData.textureAtlas.setTextures( this._renderer, bvhData.textures );

		this.scene = scene;
		this._bvhData = bvhData;
		this._pathTracer.setBVHData( bvhData );
		this.setCamera( camera );
		this.updateEnvironment();

	}

	getMaterial() {

		return this.material;

	}

	setMaterial( material ) {

		this.material = material;
		this._pathTracer.setMaterial( material );

	}

	setCamera( camera ) {

		this.camera = camera;
		this.updateCamera();

	}

	updateCamera() {

		const { camera, _renderer } = this;
		camera.coordinateSystem = _renderer.coordinateSystem;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();

		this._pathTracer.setCamera( camera );
		this.reset();

	}

	updateEnvironment() {

		const {
			_renderer,
			_pathTracer,
			scene,
			_envColorTexture,
			_backgroundColorTexture,
		} = this;

		const environment = convertToTexture( _renderer, scene.environment || _color.set( 0 ), _envColorTexture );
		const background = convertToTexture( _renderer, scene.background, _backgroundColorTexture );

		_pathTracer.setEnvironment(
			environment,
			scene.environmentIntensity,
			scene.environmentRotation,

			background,
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
		this._resetTime = 0;
		this._fadeState = 0;
		this._timer.update();

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

		const delta = 1000 * timer.getDelta();
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
		const lowResMode = this._resetTime < renderDelay;
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

		if ( ! lowResMode && pathTracer.samples >= minSamples ) {

			this._fadeState += delta / this.fadeDuration;
			this._fadeState = Math.min( 1.0, this._fadeState );

		}


		// update the samples
		if ( ! this.pause && ( ! lowResMode || ( lowResMode && dynamicLowRes ) ) ) {

			pathTracer.lowResMode = lowResMode;
			pathTracer.update();

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

	dispose() {

		this._pathTracer.dispose();
		this._blitQuad.dispose();
		this._lowResTarget.dispose();
		this._envColorTexture.dispose();
		this._backgroundColorTexture.dispose();
		this._atlasDebugQuad?.dispose();

		if ( this._debugBoundsQuad !== undefined ) {

			this._debugBoundsQuad.dispose();

		}

	}

	async getDetailedSampleCount() {

		const sampleCountTarget = this._pathTracer.sampleCountTarget;
		const { width, height } = sampleCountTarget;
		const renderer = this._renderer;

		// Create a stub "render target" with just textures field to read from the storage texture
		const targetStub = { textures: [ sampleCountTarget ] };

		const buffer = await renderer.readRenderTargetPixelsAsync( targetStub, 0, 0, width, height );
		const uintBuffer = new Uint32Array( buffer.buffer );

		// copyTexture requires a multiple of 256 bytes for texelsPerRow
		// Hence a multiple of 64 u32 per row
		const texelsPerRow = Math.ceil( width / 64 ) * 64;

		// Sum up all sample counts and divide by pixel count to get average samples per pixel
		let totalSamples = 0;
		let minSamples = Number.MAX_VALUE;
		let maxSamples = - Number.MAX_VALUE;
		for ( let i = 0, l = uintBuffer.length; i < l; i ++ ) {

			// Skip padding
			if ( i % texelsPerRow >= width ) {

				continue;

			}

			// Each entry contains sample count in lower bits and active flag in high bit
			// Mask out the active flag (0xF0000000) to get just the sample count
			const samples = uintBuffer[ i ] & 0x0FFFFFFF;

			totalSamples += samples;
			minSamples = Math.min( minSamples, samples );
			maxSamples = Math.max( maxSamples, samples );

		}

		return {
			min: minSamples,
			max: maxSamples,
			avg: Math.floor( totalSamples / ( width * height ) ),
		};


	}

	// Returns time since last reset in ms
	getRenderTime() {

		return this._resetTime;

	}

}

function convertToTexture( renderer, value, colorTexture ) {

	if ( ! value ) {

		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( _color );

		colorTexture.image.data[ 0 ] = _color.r * 255;
		colorTexture.image.data[ 1 ] = _color.g * 255;
		colorTexture.image.data[ 2 ] = _color.b * 255;
		colorTexture.image.data[ 3 ] = clearAlpha * 255;

		colorTexture.needsUpdate = true;
		value = colorTexture;

	} else if ( value.isColor ) {

		colorTexture.image.data[ 0 ] = value.r * 255;
		colorTexture.image.data[ 1 ] = value.g * 255;
		colorTexture.image.data[ 2 ] = value.b * 255;
		colorTexture.image.data[ 3 ] = 255;
		colorTexture.needsUpdate = true;
		value = colorTexture;

	} else if ( value?.isCubeTexture ) {

		value = new CubeToEquirectGenerator( renderer ).generate( value );

	}

	return value;

}
