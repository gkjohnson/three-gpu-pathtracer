import { DataTexture, LinearFilter, Vector2, Scene, PerspectiveCamera, Color, NoToneMapping, RenderTarget, FloatType, MathUtils } from 'three/webgpu';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { ObjectBVH } from './lib/ObjectBVH.js';
import { PathtracerBVHComputeData } from './nodes/PathtracerBVHComputeData.js';

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

		return MathUtils.clamp( ( performance.now() - this._resetTime - this.renderDelay ) / this.fadeDuration, 0, 1 );

	}

	useMegakernel( value ) {

		this._pathTracer.dispose();
		this._pathTracer = value ? new MegaKernelPathTracer( this._renderer ) : new WaveFrontPathTracer( this._renderer );
		this._pathTracer.setBVHData( this._bvhData );
		this.setCamera( this.camera );
		this.updateEnvironment();

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._pathTracer = new MegaKernelPathTracer( renderer );

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
		this._size = new Vector2();
		this._lowResTarget = new RenderTarget( 1, 1, { type: FloatType } );
		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// options
		this.renderDelay = 500;
		this.fadeDuration = 500;
		this.dynamicLowRes = true;
		this.lowResScale = 0.2;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;

		// initialize the scene so it doesn't fail
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setScene( scene, camera ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		// Build BVH for each mesh geometry
		scene.traverse( child => {

			if ( child.isMesh && ! child.geometry.boundsTree ) {

				child.geometry.boundsTree = new MeshBVH( child.geometry, { strategy: SAH, maxLeafSize: 5 } );

			}

		} );

		// Build TLAS and compute functions
		const objectBVH = new ObjectBVH( scene, { strategy: SAH } );
		const bvhData = new PathtracerBVHComputeData( objectBVH );
		bvhData.update();

		this.scene = scene;
		this._bvhData = bvhData;
		this._pathTracer.setBVHData( bvhData );
		this.setCamera( camera );
		this.updateEnvironment();

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
		this._resetTime = performance.now();

	}

	renderSample() {

		const renderer = this._renderer;
		const size = this._size;
		const blitQuad = this._blitQuad;
		const pathTracer = this._pathTracer;
		const lowResTarget = this._lowResTarget;
		const resetTime = this._resetTime;
		const { renderDelay, dynamicLowRes, fadeState, synchronizeRenderSize, renderScale, lowResScale } = this;

		if ( ! this._renderer._initialized ) {

			return;

		}

		// clear renderer fields
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
		const lowResMode = performance.now() - resetTime < renderDelay;
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
				lowResTarget.setSize( width, height );
				renderer.copyTextureToTexture( pathTracer.outputTarget, lowResTarget.texture );

			}

			pathTracer.setSize( width, height );

		}

		// update the samples
		if ( ! lowResMode || lowResMode && dynamicLowRes ) {

			pathTracer.lowResMode = lowResMode;
			pathTracer.update();

		}

		// render the content to the canvas
		renderer.autoClear = false;
		blitQuad.material.opacity = lowResMode && dynamicLowRes ? 1.0 : fadeState;
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

	getSampleCount() {

		return this._pathTracer.samples;

	}

	async getLatestSampleTimestamp() {

		return await this._pathTracer.getLatestSampleTimestamp();

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
