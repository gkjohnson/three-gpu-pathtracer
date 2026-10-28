import { ColorManagement, FloatType, RGBAFormat } from 'three';
import { RedIntegerFormat, StorageBufferAttribute, StorageTexture, UnsignedIntType } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';

export class PathTracerBackend {

	constructor( renderer ) {

		this.renderer = renderer;
		this.maxBounces = 15;

		// how much work a single update dispatches, in path slots. Lower values keep frames
		// responsive on slower hardware; the unit is resolution independent.
		this.frameBudget = 250000;
		this.maxTransparentBounces = 15;
		this.lowResMode = false;

		// stop taking samples once a pixel reaches this count. zero means no limit.
		this.maxSamples = 0;

		this._renderTask = null;

		this.outputTarget = new StorageTexture( 1, 1, );
		this.outputTarget.format = RGBAFormat;
		this.outputTarget.type = FloatType;
		this.outputTarget.colorSpace = ColorManagement.workingColorSpace;
		this.outputTarget.name = 'Output #0';
		this.outputTarget.generateMipmaps = false;

		this.prevOutputTarget = new StorageTexture( 1, 1, );
		this.prevOutputTarget.format = RGBAFormat;
		this.prevOutputTarget.type = FloatType;
		this.prevOutputTarget.colorSpace = ColorManagement.workingColorSpace;
		this.prevOutputTarget.name = 'Output #1';
		this.prevOutputTarget.generateMipmaps = false;

		this.sampleCountTarget = new StorageTexture( 1, 1, );
		this.sampleCountTarget.format = RedIntegerFormat;
		this.sampleCountTarget.type = UnsignedIntType;
		this.sampleCountTarget.name = 'Sample Count';
		this.sampleCountTarget.generateMipmaps = false;

		this.sampleCountClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );

		// the per pixel first hit albedo and normal, two vec4 per pixel, accumulated as denoiser
		// guides only while asked for. The kernels bind the placeholder otherwise.
		this.denoisingFeatures = false;
		this.featureBuffer = null;
		this._featurePlaceholder = new StorageBufferAttribute( 2, 4 );

	}

	// The guides start over with the render, so the render restarts with them
	setDenoisingFeatures( value ) {

		if ( this.denoisingFeatures === value ) {

			return;

		}

		this.denoisingFeatures = value;
		this._updateFeatureBuffers();
		this.reset();

	}

	setRandom( random ) {

	}

	setBVHData( data ) {

	}

	setTextures( textures ) {

	}

	setMaterial( material ) {

	}

	setFilterGlossy( value ) {

	}

	setClamping( _direct, _indirect ) {

	}

	setEnvironment(
		envMap,
		envMapIntensity,
		envMapRotation,
	) {

	}

	setLights( lights ) {

	}

	setBackground(
		background,
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

	}

	// Rebuild the render task after a shader-generating function changes.
	rebuild() {

		this._renderTask = null;

	}

	setSize( w, h ) {

		w = Math.ceil( w );
		h = Math.ceil( h );

		const { width, height } = this.outputTarget;
		if ( width === w && height === h ) {

			return false;

		}

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();

		this.outputTarget = this.outputTarget.clone();
		this.prevOutputTarget = this.outputTarget.clone();
		this.sampleCountTarget = this.sampleCountTarget.clone();

		this.outputTarget.setSize( w, h );
		this.prevOutputTarget.setSize( w, h );
		this.sampleCountTarget.setSize( w, h );
		this._updateFeatureBuffers();

		this.reset();
		return true;

	}

	getSize( target ) {

		const { width, height } = this.outputTarget;
		target.x = width;
		target.y = height;

		return target;

	}

	update() {

		const { renderer } = this;
		if ( ! renderer.initialized ) {

			return;

		}

		if ( ! this._renderTask ) {

			this._renderTask = this.createRenderTask();

		}

		this._renderTask.next();

	}

	*createRenderTask() {

	}

	// Measures the current per pixel sample counts. Backends that need GPU work to answer this do
	// it here, so it only happens when asked for rather than every round.
	async getSampleCountsAsync() {

		return { min: 0, max: 0, avg: 0 };

	}

	resetSeed() {}

	reset() {

		const {
			renderer,
			outputTargetClearKernel,
			sampleCountClearKernel,

			outputTarget,
			prevOutputTarget,
			sampleCountTarget,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		const { width, height } = outputTarget;
		const dispatchSize = outputTargetClearKernel.getDispatchSize( width, height );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = prevOutputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		// the guides are only rewritten as paths finish, so stale values would show until then. The
		// buffer only exists on the device once a kernel has bound it, and starts out zeroed.
		if ( this.featureBuffer ) {

			const buffer = renderer.backend.get( this.featureBuffer ).buffer;
			if ( buffer ) {

				const device = renderer.backend.device;
				const encoder = device.createCommandEncoder();
				encoder.clearBuffer( buffer );
				device.queue.submit( [ encoder.finish() ] );

			}

		}

		this._renderTask = null;

	}

	// Allocates the guide buffer for the current size, or drops it. The first sample of every
	// pixel overwrites it, so it needs no clearing.
	_updateFeatureBuffers() {

		this.featureBuffer?.dispose();
		this.featureBuffer = null;

		if ( this.denoisingFeatures ) {

			const { width, height } = this.outputTarget;
			this.featureBuffer = new StorageBufferAttribute( 2 * width * height, 4 );
			this.featureBuffer.name = 'Denoising Features';

		}

	}

	dispose() {

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();
		this.sampleCountClearKernel.dispose();
		this.outputTargetClearKernel.dispose();
		this.featureBuffer?.dispose();
		this._featurePlaceholder.dispose();

		this._renderTask = null;

	}

}
