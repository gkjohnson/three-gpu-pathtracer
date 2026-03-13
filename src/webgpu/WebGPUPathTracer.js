import { DataTexture, LinearFilter, Vector2, Scene, PerspectiveCamera, Color, NoToneMapping, FloatType, Timer, StorageTexture } from 'three/webgpu';
import { SkinnedMeshBVH, MeshBVH, SAH } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { PathtracerBVHComputeData } from './nodes/PathtracerBVHComputeData.js';
import { RenderTarget2DArray } from './RenderTarget2DArray.js';

const _resolution = new Vector2();
const _color = new Color();
export class WebGPUPathTracer {

	get bounces() {

		return this._pathTracer.bounces;

	}

	set bounces( v ) {

		this._pathTracer.bounces = v;

	}

	get samples() {

		return this._pathTracer.samples;

	}

	get fadeState() {

		return this._fadeState;

	}

	useMegakernel( value ) {

		this._pathTracer.dispose();
		this._pathTracer = value ? new MegaKernelPathTracer( this._renderer ) : new WaveFrontPathTracer( this._renderer );
		this._pathTracer.setBVHData( this._bvhData );
		this._pathTracer.setTextures( this.textureArray.texture );
		this.setCamera( this.camera );
		this.updateEnvironment();

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._pathTracer = new MegaKernelPathTracer( renderer );
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

		this._resetTime = - 1;
		this._fadeState = 0;
		this._size = new Vector2();
		this._lowResTarget = new StorageTexture( 1, 1 );
		this._lowResTarget.type = FloatType;
		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// options
		this.minSamples = 1;
		this.renderDelay = 500;
		this.fadeDuration = 500;
		this.dynamicLowRes = true;
		this.lowResScale = 0.2;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;

		this.textureArray = new RenderTarget2DArray( 1024, 1024 );

		// initialize the scene so it doesn't fail
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setScene( scene, camera ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		// Build BVH for each mesh geometry
		scene.traverse( child => {

			if ( child.isSkinnedMesh ) {

				if ( ! child.boundsTree ) {

					child.boundsTree = new SkinnedMeshBVH( child, { strategy: SAH, maxLeafSize: 5, indirect: true } );

				} else {

					child.boundsTree.refit();

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

		this.textureArray.setTextures( this._renderer, bvhData.textures );
		this._pathTracer.setTextures( this.textureArray.texture );

		this.scene = scene;
		this._bvhData = bvhData;
		this._pathTracer.setBVHData( bvhData );
		this.setCamera( camera );
		this.updateEnvironment();

	}

	setMaterial( material ) {

		this._pathTracer.setMaterial( material );

	}

	// TODO: support async generation of ObjectBVH
	setSceneAsync( ...args ) {

		this.setScene( ...args );

	}

	setCamera( camera ) {

		this.camera = camera;
		this.updateCamera();

	}

	updateCamera() {

		const camera = this.camera;
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

		const delta = 1000 * timer.getDelta();
		this._resetTime += delta;

		const originalToneMapping = renderer.toneMapping;
		const originalExposure = renderer.toneMappingExposure;
		const originalTarget = renderer.getRenderTarget();
		const originalAutoClear = renderer.autoClear;
		renderer.toneMapping = NoToneMapping;
		renderer.toneMappingExposure = 1.0;

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
		if ( ! lowResMode || ( lowResMode && dynamicLowRes ) ) {

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
		blitQuad.material.toneMapping = originalToneMapping;
		blitQuad.material.toneMappingExposure = originalExposure;
		blitQuad.render( renderer );

		// reset the renderer
		renderer.autoClear = originalAutoClear;
		renderer.toneMapping = originalToneMapping;
		renderer.toneMappingExposure = originalExposure;
		renderer.setRenderTarget( originalTarget );

	}

	dispose() {

		this._pathTracer.dispose();
		this._blitQuad.dispose();
		this._lowResTarget.dispose();
		this._envColorTexture.dispose();
		this._backgroundColorTexture.dispose();

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
