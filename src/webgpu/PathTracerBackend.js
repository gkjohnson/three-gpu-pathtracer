import { StorageBufferAttribute } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { createOutputTarget, createSampleCountTarget } from './compute/targets.js';

// the async compile state of a compute node. A node with no state has not been requested.
const COMPILE_STARTED = 0;
const COMPILE_COMPLETE = 1;

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

		// whether kernels compile asynchronously before their first dispatch rather than on it
		this.asyncCompile = false;

		// whether the render task is waiting on its kernels to compile, during which nothing renders
		this.compiling = false;

		this._renderTask = null;
		this._compileState = new WeakMap();

		this.outputTarget = createOutputTarget( 'Output #0' );
		this.prevOutputTarget = createOutputTarget( 'Output #1' );
		this.sampleCountTarget = createSampleCountTarget( 'Sample Count' );

		this.sampleCountClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );

		// the per pixel first hit albedo and normal, two vec4 per pixel, accumulated as the denoiser's
		// auxiliary buffers only while asked for. The kernels bind the placeholder otherwise.
		this.auxBuffers = false;
		this.auxBuffer = null;
		this._auxPlaceholder = new StorageBufferAttribute( 2, 4 );

	}

	// The auxiliary buffers start over with the render, so the render restarts with them
	setAuxBuffers( value ) {

		if ( this.auxBuffers === value ) {

			return;

		}

		this.auxBuffers = value;
		this._updateAuxBuffer();
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

	// Compiles the kernels asynchronously and yields until they're ready so the first dispatch doesn't
	// block on a synchronous compile. A kernel is only requested once, so a render task started by a
	// reset waits on a compile already in flight rather than dispatching before its pipeline exists.
	*compileKernels( kernels ) {

		const { renderer, _compileState } = this;

		// three.js <= r185 has no async compute compile
		if ( ! this.asyncCompile || ! renderer.compileComputeAsync ) {

			return;

		}

		// TODO: three.js resolves a second "compileComputeAsync" call for a pipeline still compiling
		// immediately. If it returned the pending compile instead, this state tracking could be removed.
		const computeNodes = kernels.map( kernel => kernel.kernel );
		const requested = computeNodes.filter( computeNode => ! _compileState.has( computeNode ) );
		if ( requested.length > 0 ) {

			requested.forEach( computeNode => _compileState.set( computeNode, COMPILE_STARTED ) );
			renderer.compileComputeAsync( requested )
				.catch( () => {

					// a failed compile is retried, and reported, by the dispatch

				} )
				.finally( () => {

					requested.forEach( computeNode => _compileState.set( computeNode, COMPILE_COMPLETE ) );

				} );

		}

		while ( computeNodes.some( computeNode => _compileState.get( computeNode ) !== COMPILE_COMPLETE ) ) {

			this.compiling = true;
			yield;

		}

		this.compiling = false;

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
		this._updateAuxBuffer();

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

		// the auxiliary buffers are only rewritten as paths finish, so stale values would show until
		// then. The buffer only exists on the device once a kernel has bound it, and starts out zeroed.
		if ( this.auxBuffer ) {

			const buffer = renderer.backend.get( this.auxBuffer ).buffer;
			if ( buffer ) {

				const device = renderer.backend.device;
				const encoder = device.createCommandEncoder();
				encoder.clearBuffer( buffer );
				device.queue.submit( [ encoder.finish() ] );

			}

		}

		this._renderTask = null;

	}

	// Allocates the auxiliary buffer for the current size, or drops it. The first sample of every
	// pixel overwrites it, so it needs no clearing.
	_updateAuxBuffer() {

		this.auxBuffer?.dispose();
		this.auxBuffer = null;

		if ( this.auxBuffers ) {

			const { width, height } = this.outputTarget;
			this.auxBuffer = new StorageBufferAttribute( 2 * width * height, 4 );
			this.auxBuffer.name = 'Auxiliary Buffers';

		}

	}

	dispose() {

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();
		this.sampleCountClearKernel.dispose();
		this.outputTargetClearKernel.dispose();
		this.auxBuffer?.dispose();
		this._auxPlaceholder.dispose();

		this._renderTask = null;

	}

}
