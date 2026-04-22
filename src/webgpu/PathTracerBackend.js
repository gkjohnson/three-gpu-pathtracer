import { ColorManagement, FloatType, RGBAFormat } from 'three';
import { RedIntegerFormat, StorageTexture, UnsignedIntType } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { GltfCompliantMaterial } from './materials/GltfCompliantMaterial.js';

export class PathTracerBackend {

	constructor( renderer ) {

		this.renderer = renderer;
		this.camera = null;
		this.samples = 0;
		this.bounces = 7;
		this.lowResMode = false;

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

		this.material = new GltfCompliantMaterial();

	}

	setCamera( camera ) {

		this.camera = camera;
		this.reset();

	}

	setBVHData( data ) {

	}

	setTextures( textures ) {

	}

	setMaterial( material ) {

	}

	setEnvironment(
		envMap,
		envMapIntensity,
		envMapRotation,

		background,
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

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

		const { camera, renderer } = this;
		if ( ! camera || ! renderer.initialized ) {

			return;

		}

		if ( ! this.material.initialized ) {

			this.material.init( renderer );
			this.material.initialized = true;

		}

		if ( ! this._renderTask ) {

			this._renderTask = this.createRenderTask();

		}

		this._renderTask.next();

	}

	*createRenderTask() {

	}

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

		this.samples = 0;
		this._renderTask = null;

	}

	dispose() {

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();

		this._renderTask = null;

	}

}
