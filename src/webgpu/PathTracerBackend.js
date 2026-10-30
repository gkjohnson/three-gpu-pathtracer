import { MathUtils, TimestampQuery } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './compute/targets.js';
import { AUX_LAYERS } from './nodes/aux.wgsl.js';

// the async compile state of a compute node. A node with no state has not been requested.
const COMPILE_STARTED = 0;
const COMPILE_COMPLETE = 1;

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

export class PathTracerBackend {

	constructor( renderer ) {

		this.renderer = renderer;
		this.maxBounces = 15;

		// how much work a single update dispatches, in path slots. Lower values keep frames
		// responsive on slower hardware; the unit is resolution independent.
		this.frameBudget = 250000;

		// whether "frameBudget" is adjusted to keep each update near "targetFrameTime" milliseconds of gpu
		// time. Needs a renderer created with "trackTimestamp".
		this.adaptiveFrameBudget = true;
		this.targetFrameTime = 16;

		this.maxTransparentBounces = 15;
		this.lowResMode = false;

		// the gpu time of the last low res preview update per pixel, in milliseconds. Zero until measured
		this.lowResPixelTime = 0;

		// stop taking samples once a pixel reaches this count. zero means no limit.
		this.maxSamples = 0;

		// whether kernels compile asynchronously before their first dispatch rather than on it
		this.asyncCompile = false;

		// whether the render task is waiting on its kernels to compile, during which nothing renders
		this.compiling = false;

		// the gpu time of the last timed update, in milliseconds, from three's timestamp queries. Only
		// measured when the renderer is created with "trackTimestamp".
		this.frameTime = 0;

		this._renderTask = null;
		this._compileState = new WeakMap();

		// the timestamp ids of the dispatches in the update being timed, whether a measurement is
		// still reading back, and whether the missing timestamp warning has been logged
		this._timestampUIDs = null;
		this._timingFrame = false;
		this._warnedTimestamps = false;

		// the sum and count of the frame times measured at the current budget that the adaptive budget
		// is set from
		this._frameTimeTotal = 0;
		this._frameTimeCount = 0;

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

		const { trackTimestamp } = renderer.backend;
		if ( this.adaptiveFrameBudget && ! trackTimestamp && ! this._warnedTimestamps ) {

			console.warn( 'PathTracerBackend: "adaptiveFrameBudget" needs timestamp queries. Create the renderer with "trackTimestamp: true" on a device that supports them.' );
			this._warnedTimestamps = true;

		}

		// time this update unless the last measurement is still reading back
		const timed = trackTimestamp && ! this._timingFrame;
		const budget = this.frameBudget;
		this._timestampUIDs = timed ? [] : null;
		this._renderTask.next();

		// an update that dispatched nothing, such as one waiting on kernels to compile, isn't kept
		if ( timed && this._timestampUIDs.length > 0 ) {

			this._measureFrameTime( this._timestampUIDs, budget );

		}

		this._timestampUIDs = null;

	}

	// Dispatches a kernel, recording its timestamp id while the update is being timed
	dispatch( kernel, dispatchSize ) {

		const { renderer } = this;
		renderer.compute( kernel.kernel, dispatchSize );
		this._timestampUIDs?.push( renderer.backend.getTimestampUID( kernel.kernel ) );

	}

	// Reads back the gpu time of an update's dispatches into "frameTime" and adapts the budget to it
	async _measureFrameTime( uids, budget ) {

		const { renderer } = this;
		const { backend } = renderer;
		const lowResMode = this.lowResMode;
		const { width, height } = this.outputTarget;

		this._timingFrame = true;
		await renderer.resolveTimestampsAsync( TimestampQuery.COMPUTE );
		this._timingFrame = false;

		// a resolve already in flight when the update dispatched won't hold its queries
		if ( ! uids.every( uid => backend.hasTimestampQuery( uid ) ) ) {

			return;

		}

		this.frameTime = uids.reduce( ( sum, uid ) => sum + backend.getTimestamp( uid ), 0 );

		// the low res preview traces every pixel each update, and is sized from its own time
		if ( lowResMode ) {

			this.lowResPixelTime = this.frameTime / ( width * height );

		} else if ( this.adaptiveFrameBudget ) {

			this._adaptFrameBudget( this.frameTime, budget );

		}

	}

	// Moves "frameBudget" toward the slot count that would take "targetFrameTime"
	_adaptFrameBudget( frameTime, budget ) {

		// a measurement from before the budget changed doesn't describe the current one
		if ( budget !== this.frameBudget ) {

			this._frameTimeTotal = 0;
			this._frameTimeCount = 0;
			return;

		}

		this._frameTimeTotal += frameTime;
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

		// scale the work done to land the average on the target. A budget past the pixel count does no
		// more work, so it is capped there.
		const { width, height } = this.outputTarget;
		const pixelCount = width * height;
		const next = Math.min( budget, pixelCount ) * targetFrameTime / average;
		const stepped = MathUtils.clamp( next, budget / BUDGET_MAX_STEP, budget * BUDGET_MAX_STEP );
		this.frameBudget = MathUtils.clamp( Math.round( stepped ), MIN_FRAME_BUDGET, Math.max( MIN_FRAME_BUDGET, pixelCount ) );

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
		this._frameTimeTotal = 0;
		this._frameTimeCount = 0;

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
