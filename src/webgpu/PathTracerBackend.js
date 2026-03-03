import { ColorManagement, FloatType, LinearFilter, RGBAFormat } from 'three';
import { StorageTexture } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';

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
		this.outputTarget.magFilter = LinearFilter;
		this.outputTarget.colorSpace = ColorManagement.workingColorSpace;
		this.outputTarget.name = 'Output #0';
		this.outputTarget.generateMipmaps = false;

		this.prevOutputTarget = new StorageTexture( 1, 1, );
		this.prevOutputTarget.format = RGBAFormat;
		this.prevOutputTarget.type = FloatType;
		this.prevOutputTarget.magFilter = LinearFilter;
		this.prevOutputTarget.colorSpace = ColorManagement.workingColorSpace;
		this.prevOutputTarget.name = 'Output #1';
		this.prevOutputTarget.generateMipmaps = false;

		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );

	}

	setCamera( camera ) {

		this.camera = camera;
		this.reset();

	}

	setBVHData( data ) {

	}

	setTextures( textures ) {

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

		this.outputTarget = this.outputTarget.clone();
		this.prevOutputTarget = this.outputTarget.clone();

		this.outputTarget.setSize( w, h );
		this.prevOutputTarget.setSize( w, h );

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

		if ( ! this._renderTask ) {

			this._renderTask = this.createRenderTask();

		}

		this._renderTask.next();

	}

	*createRenderTask() {

	}

	reset() {

		const { renderer, outputTargetClearKernel, outputTarget, prevOutputTarget } = this;

		if ( ! renderer.initialized ) {

			return;

		}

		const { width, height } = outputTarget;
		const dispatchSize = outputTargetClearKernel.getDispatchSize( width, height );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = prevOutputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		this.samples = 0;
		this._renderTask = null;

	}

	dispose() {

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this._renderTask = null;

	}

}
