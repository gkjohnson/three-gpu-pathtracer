import { Matrix4, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';

function* renderTask() {

	const {
		renderer,
		camera,
		kernel,
		bounces,

		tiles,
		outputTarget,
		sampleCountTarget,
	} = this;

	camera.updateMatrixWorld();

	// init parameters
	kernel.outputTarget = outputTarget;
	kernel.sampleCountTarget = sampleCountTarget;

	kernel.bounces = bounces;
	kernel.inverseProjectionMatrix.copy( camera.projectionMatrixInverse );
	kernel.cameraToModelMatrix.copy( camera.matrixWorld );

	while ( true ) {

		const tileSize = this.getTileSize( kernel.tileSize );
		const dispatchSize = kernel.getDispatchSize( tileSize.x, tileSize.y );
		kernel.seed += 1;

		// Swap targets to support devices without <rgba32float, read_write> textures
		// Copy latest data to a new outputTarget to keep the appearance
		renderer.copyTextureToTexture( this.outputTarget, this.prevOutputTarget );
		[ this.outputTarget, this.prevOutputTarget ] = [ this.prevOutputTarget, this.outputTarget ];
		kernel.prevOutputTarget = this.prevOutputTarget;
		kernel.outputTarget = this.outputTarget;

		for ( let x = 0; x < tiles.x; x ++ ) {

			for ( let y = 0; y < tiles.y; y ++ ) {

				kernel.offset.set( x, y ).multiply( tileSize );
				renderer.compute( kernel.kernel, dispatchSize );
				yield;

			}

		}

		this.samples ++;

	}

}

export class MegaKernelPathTracer {

	constructor( renderer ) {

		this.camera = null;
		this.renderer = renderer;
		this._task = null;

		// options
		this.samples = 0;
		this.bounces = 7;
		this.tiles = new Vector2( 2, 2 );

		this.envInfo = new EquirectHdrInfoUniform();

		// targets
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

		this.sampleCountTarget = new StorageTexture( 1, 1, );
		this.sampleCountTarget.format = RedIntegerFormat;
		this.sampleCountTarget.type = UnsignedIntType;
		this.sampleCountTarget.name = 'Sample Count';
		this.sampleCountTarget.generateMipmaps = false;

		// kernels
		this.kernel = new PathTracerMegaKernel().setWorkgroupSize( 8, 8, 1 );
		this.sampleCountClearKernel = new ZeroOutKernel( { textureType: 'r32uint' } ).setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );

	}

	setBVHData( bvhData ) {

		this.kernel.bvhData = bvhData;
		this.kernel.needsUpdate = true;
		this.reset();

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

		const { kernel } = this;

		if ( kernel.background.isTexture ) {

			kernel.background.dispose();

		}

		if ( envMap !== null ) {

			this.envInfo.updateFrom( envMap );
			kernel.envMap = this.envInfo.map;
			kernel.kernel.computeNode.parameters.envMapSampler.node.value = this.envInfo.map;

		}

		const rotationMatrix = new Matrix4().makeRotationFromEuler( envMapRotation ).invert();
		kernel.envMapRotation.setFromMatrix4( rotationMatrix );
		kernel.envMapIntensity = envMapIntensity;

		kernel.background = background;
		kernel.kernel.computeNode.parameters.backgroundSampler.node.value = background;
		rotationMatrix.makeRotationFromEuler( backgroundRotation ).invert();
		kernel.backgroundRotation.setFromMatrix4( rotationMatrix );
		kernel.backgroundIntensity = backgroundIntensity;
		kernel.backgroundBlurriness = backgroundBlurriness;

	}

	setCamera( camera ) {

		this.camera = camera;
		this.reset();

	}

	setSize( w, h ) {

		w = Math.ceil( w );
		h = Math.ceil( h );

		const { width, height } = this.outputTarget;
		if ( width === w && height === h ) {

			return;

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

	}

	getSize( target ) {

		target.x = this.outputTarget.width;
		target.y = this.outputTarget.height;

		return target;

	}

	setTiles( tiles ) {

		this.tiles.copy( tiles );

	}

	getTileSize( target ) {

		this.getSize( target ).divide( this.tiles ).ceil();

		return target;

	}

	dispose() {

		// TODO: dispose of all buffers
		this.envInfo.dispose();
		this._task = null;

	}

	reset() {

		const {
			renderer,
			sampleCountClearKernel,
			outputTargetClearKernel,
			sampleCountTarget,
			outputTarget,
			prevOutputTarget,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		this.samples = 0;
		this._task = null;

		const { width, height } = sampleCountTarget;
		const dispatchSize = sampleCountClearKernel.getDispatchSize( width, height );

		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = prevOutputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

	}

	update() {

		if ( ! this.camera || ! this.kernel ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
