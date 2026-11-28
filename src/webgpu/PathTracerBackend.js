import { StorageBufferAttribute, TimestampQuery } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { createAuxTarget, createOutputTarget, createSampleCountTarget } from './compute/targets.js';
import { AUX_LAYERS } from './nodes/auxiliary.wgsl.js';
import {
	PrimeSampleCountersKernel,
	TallySampleCountsKernel,
	SAMPLE_COUNTER_FINISHED_COUNT,
	SAMPLE_COUNTER_LENGTH,
	SAMPLE_COUNTER_MAX,
	SAMPLE_COUNTER_MIN,
	SAMPLE_COUNTER_PIXEL_COUNT,
	SAMPLE_COUNTER_TOTAL_HI,
	SAMPLE_COUNTER_TOTAL_LO,
	U32_RANGE,
} from './compute/TallySampleCountsKernel.js';

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
		this.maxSubsurfaceBounces = 256;
		this.maxFogBounces = 0;
		this.lowResMode = false;
		this.stableNoise = true;

		// whether camera rays may start inside a volume
		this.cameraInVolume = true;

		// the light clamping values, shared with the kernels through their context
		this.clampDirect = uniform( 0 );
		this.clampIndirect = uniform( 10 );

		// stop taking samples once a pixel reaches this count. zero means no limit.
		this.maxSamples = 0;

		// whether the kernels are compiling, during which nothing renders
		this.compiling = false;

		// the gpu time of the last timed update and the budget it ran with. "count" increments per measurement
		this.timing = { count: 0, frameTime: 0, frameBudget: 0 };

		this._renderTask = null;
		this._compileState = new WeakMap();

		// the timestamp ids of the dispatches in the update being timed, and whether a measurement is
		// still reading back
		this._timestampUIDs = null;
		this._timingFrame = false;

		this.outputTarget = createOutputTarget( 'Output' );
		this.sampleCountTarget = createSampleCountTarget( 'Sample Count' );

		this.sampleCountClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.auxTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );

		// the per pixel first hit albedo and normal, accumulated as the denoiser's auxiliary images only
		// while asked for. The kernels bind the placeholder otherwise.
		this.auxTarget = null;
		this._auxPlaceholder = createAuxTarget();

		// reduction target for the per pixel sample counts, read back asynchronously
		this.sampleCountersStorage = new StorageBufferAttribute( new Uint32Array( SAMPLE_COUNTER_LENGTH ), SAMPLE_COUNTER_LENGTH );
		this.sampleCountersStorage.name = 'Sample Counters';
		this.primeSampleCountersKernel = new PrimeSampleCountersKernel().setWorkgroupSize( 1, 1, 1 );
		this.tallySampleCountsKernel = new TallySampleCountsKernel().setWorkgroupSize( 8, 8, 1 );
		this._samplesPromise = null;

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

	setShadingModel( shadingModel ) {

	}

	// the camera's uniforms, which the material graphs read in place of three.js' camera nodes
	setCameraUniforms( cameraUniforms ) {

	}

	setFilterGlossy( value ) {

	}

	setClamping( direct, indirect ) {

		this.clampDirect.value = direct;
		this.clampIndirect.value = indirect;
		this.reset();

	}

	setLightsInfo( lightsInfo ) {

	}

	setBackgroundInfo( backgroundInfo ) {

	}

	// Compiles the kernels asynchronously, with "compiling" set until they're ready, so the first dispatch
	// doesn't block on a synchronous compile. Called every frame before rendering.
	compileKernels( kernels ) {

		const { renderer, _compileState } = this;

		// three.js <= r185 has no async compute compile
		if ( ! renderer.compileComputeAsync || this._renderTask ) {

			return;

		}

		// TODO: three.js resolves a second "compileComputeAsync" call for a pipeline still compiling
		// immediately. If it returned the pending compile instead, this state tracking could be removed.
		const computeNodes = kernels.map( kernel => kernel.kernel );
		const requested = computeNodes.filter( computeNode => ! _compileState.has( computeNode ) );
		if ( this.compiling && requested.length > 0 ) {

			// requested on the second call to let a frame present before the compile blocks the main thread
			requested.forEach( computeNode => _compileState.set( computeNode, COMPILE_STARTED ) );
			renderer.compileComputeAsync( requested )
				.catch( () => {

					// a failed compile is retried, and reported, by the dispatch

				} )
				.finally( () => {

					requested.forEach( computeNode => _compileState.set( computeNode, COMPILE_COMPLETE ) );

				} );

		}

		this.compiling = computeNodes.some( computeNode => _compileState.get( computeNode ) !== COMPILE_COMPLETE );

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
		this.sampleCountTarget.dispose();

		this.outputTarget = this.outputTarget.clone();
		this.sampleCountTarget = this.sampleCountTarget.clone();

		this.outputTarget.setSize( w, h, this.outputTarget.depth );
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

	// the most pixels a preview frame can render within the frame budget
	getPreviewPixelBudget() {

		return this.frameBudget;

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
		const { renderer, timing, frameBudget } = this;
		const { backend } = renderer;

		this._timingFrame = true;
		await renderer.resolveTimestampsAsync( TimestampQuery.COMPUTE );
		this._timingFrame = false;

		// a resolve already in flight when the update dispatched won't hold its queries
		if ( ! uids.every( uid => backend.hasTimestampQuery( uid ) ) ) {

			return;

		}

		timing.frameTime = uids.reduce( ( sum, uid ) => sum + backend.getTimestamp( uid ), 0 );
		timing.frameBudget = frameBudget;
		timing.count ++;

	}

	*createRenderTask() {

	}

	// Reduces the per pixel sample counts and reads them back, with the share of pixels at the sample limit. Runs a
	// full resolution pass, so it only happens when asked for.
	getSampleCountsAsync() {

		// share the in flight measurement rather than dispatching another
		if ( this._samplesPromise === null ) {

			const promise = this._measureSampleCounts().finally( () => {

				// a reset may have started a newer measurement in the meantime
				if ( this._samplesPromise === promise ) {

					this._samplesPromise = null;

				}

			} );

			this._samplesPromise = promise;

		}

		return this._samplesPromise;

	}

	async _measureSampleCounts() {

		const {
			renderer,
			sampleCountTarget,
			sampleCountersStorage,
			primeSampleCountersKernel,
			tallySampleCountsKernel,
		} = this;

		if ( ! renderer.initialized || this.lowResMode ) {

			return { min: 0, max: 0, avg: 0, finished: 0, unfinishedPixels: Infinity };

		}

		primeSampleCountersKernel.counters = sampleCountersStorage;
		renderer.compute( primeSampleCountersKernel.kernel, [ 1, 1, 1 ] );

		tallySampleCountsKernel.counters = sampleCountersStorage;
		tallySampleCountsKernel.sampleCountTarget = sampleCountTarget;
		tallySampleCountsKernel.maxSamples = this.maxSamples;
		renderer.compute(
			tallySampleCountsKernel.kernel,
			tallySampleCountsKernel.getDispatchSize( sampleCountTarget.width, sampleCountTarget.height ),
		);

		const buffer = await renderer.getArrayBufferAsync( sampleCountersStorage );
		const counters = new Uint32Array( buffer );
		const pixelCount = counters[ SAMPLE_COUNTER_PIXEL_COUNT ];

		// no camera ray has been dispatched yet, so there is nothing to average over
		if ( pixelCount === 0 ) {

			return { min: 0, max: 0, avg: 0, finished: 0, unfinishedPixels: Infinity };

		}

		// the total is accumulated as a split 64 bit value to survive high sample counts
		const total = counters[ SAMPLE_COUNTER_TOTAL_HI ] * U32_RANGE + counters[ SAMPLE_COUNTER_TOTAL_LO ];
		const finishedPixels = counters[ SAMPLE_COUNTER_FINISHED_COUNT ];

		return {
			min: counters[ SAMPLE_COUNTER_MIN ],
			max: counters[ SAMPLE_COUNTER_MAX ],
			avg: total / pixelCount,
			finished: finishedPixels / pixelCount,
			unfinishedPixels: pixelCount - finishedPixels,
		};

	}

	reset() {

		const {
			renderer,
			outputTargetClearKernel,
			sampleCountClearKernel,

			outputTarget,
			sampleCountTarget,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		const { width, height, depth } = outputTarget;
		const dispatchSize = outputTargetClearKernel.getDispatchSize( width, height );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, outputTargetClearKernel.getDispatchSize( width, height, depth ) );

		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		// pixels that never take another sample, such as ones the camera declines, would keep stale values
		if ( this.auxTarget ) {

			const { auxTargetClearKernel } = this;
			auxTargetClearKernel.target = this.auxTarget;
			renderer.compute( auxTargetClearKernel.kernel, auxTargetClearKernel.getDispatchSize( width, height, AUX_LAYERS ) );

		}

		this._renderTask = null;
		this._samplesPromise = null;

	}

	dispose() {

		this.outputTarget.dispose();
		this.sampleCountTarget.dispose();
		this.sampleCountClearKernel.dispose();
		this.outputTargetClearKernel.dispose();
		this.auxTargetClearKernel.dispose();
		this.auxTarget?.dispose();
		this._auxPlaceholder.dispose();
		this.sampleCountersStorage.dispose();
		this.primeSampleCountersKernel.dispose();
		this.tallySampleCountsKernel.dispose();

		this._renderTask = null;

	}

}
