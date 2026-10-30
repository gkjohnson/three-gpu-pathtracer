import { TimestampQuery, Vector4 } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './compute/targets.js';
import { AUX_LAYERS } from './nodes/aux.wgsl.js';
import { MEDIUM_STACK_EMPTY } from './nodes/medium.wgsl.js';

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
		this.maxVolumeSteps = 256;
		this.lowResMode = false;

		// the object indices of the media the camera is inside of, as the medium stack camera rays start with
		this.cameraMediumStack = new Vector4().setScalar( MEDIUM_STACK_EMPTY );

		// stop taking samples once a pixel reaches this count. zero means no limit.
		this.maxSamples = 0;

		// whether kernels compile asynchronously before their first dispatch rather than on it
		this.asyncCompile = false;

		// whether the render task is waiting on its kernels to compile, during which nothing renders
		this.compiling = false;

		// the gpu time of the last timed update and what it ran with. "count" increments per measurement
		this.timing = { count: 0, frameTime: 0, frameBudget: 0, lowResMode: false, pixelCount: 0 };

		this._renderTask = null;
		this._compileState = new WeakMap();

		// the timestamp ids of the dispatches in the update being timed, and whether a measurement is
		// still reading back
		this._timestampUIDs = null;
		this._timingFrame = false;

		this.outputTarget = createOutputTarget( 'Output #0' );
		this.prevOutputTarget = createOutputTarget( 'Output #1' );
		this.sampleCountTarget = createSampleCountTarget( 'Sample Count' );

		this.sampleCountClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.auxTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );

		// the per pixel first hit albedo and normal, accumulated as the denoiser's auxiliary images only
		// while asked for. The kernels bind the placeholder otherwise.
		this.auxTarget = null;
		this._auxPlaceholder = createAuxTarget();

	}

	// The auxiliary images start over with the render, so the render restarts with them
	setAccumulateAux( value ) {

		if ( Boolean( this.auxTarget ) === value ) {

			return;

		}

		this.auxTarget?.dispose();
		this.auxTarget = null;

		if ( value ) {

			const { width, height } = this.outputTarget;
			this.auxTarget = createAuxTarget( 'Auxiliary Images' );
			this.auxTarget.setSize( width, height, AUX_LAYERS );

		}

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
		this.auxTarget?.setSize( w, h, AUX_LAYERS );

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

		// time this update unless the last measurement is still reading back
		const timed = renderer.backend.trackTimestamp && ! this._timingFrame;
		this._timestampUIDs = timed ? [] : null;
		this._renderTask.next();

		// an update that dispatched nothing, such as one waiting on kernels to compile, isn't kept
		if ( timed && this._timestampUIDs.length > 0 ) {

			this._measureFrameTime( this._timestampUIDs );

		}

		this._timestampUIDs = null;

	}

	// Dispatches a kernel, recording its timestamp id while the update is being timed
	dispatch( kernel, dispatchSize ) {

		const { renderer } = this;
		renderer.compute( kernel.kernel, dispatchSize );
		this._timestampUIDs?.push( renderer.backend.getTimestampUID( kernel.kernel ) );

	}

	// Reads back the gpu time of an update's dispatches into "timing"
	async _measureFrameTime( uids ) {

		// what the update ran with, read before the readback since it may change meanwhile
		const { renderer, timing, frameBudget, lowResMode } = this;
		const { backend } = renderer;
		const { width, height } = this.outputTarget;

		this._timingFrame = true;
		await renderer.resolveTimestampsAsync( TimestampQuery.COMPUTE );
		this._timingFrame = false;

		// a resolve already in flight when the update dispatched won't hold its queries
		if ( ! uids.every( uid => backend.hasTimestampQuery( uid ) ) ) {

			return;

		}

		timing.frameTime = uids.reduce( ( sum, uid ) => sum + backend.getTimestamp( uid ), 0 );
		timing.frameBudget = frameBudget;
		timing.lowResMode = lowResMode;
		timing.pixelCount = width * height;
		timing.count ++;

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

		// pixels that never take another sample, such as ones the camera declines, would keep stale values
		if ( this.auxTarget ) {

			const { auxTargetClearKernel } = this;
			auxTargetClearKernel.target = this.auxTarget;
			renderer.compute( auxTargetClearKernel.kernel, auxTargetClearKernel.getDispatchSize( width, height, AUX_LAYERS ) );

		}

		this._renderTask = null;

	}

	dispose() {

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();
		this.sampleCountClearKernel.dispose();
		this.outputTargetClearKernel.dispose();
		this.auxTargetClearKernel.dispose();
		this.auxTarget?.dispose();
		this._auxPlaceholder.dispose();

		this._renderTask = null;

	}

}
