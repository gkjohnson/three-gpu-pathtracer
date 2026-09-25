import { Matrix4, StorageBufferAttribute, Vector2 } from 'three/webgpu';
import { PopulatePixelIndicesKernel } from './compute/wavefront/PopulatePixelIndicesKernel.js';
import { LogicKernel } from './compute/wavefront/LogicKernel.js';
import { MaterialKernel } from './compute/wavefront/MaterialKernel.js';
import { TraceRayKernel } from './compute/wavefront/TraceRayKernel.js';
import { TraceShadowRayKernel } from './compute/wavefront/TraceShadowRayKernel.js';
import { QueueLengthToDispatchKernel } from './compute/wavefront/QueueLengthToDispatchKernel.js';
import { ResetSlotsKernel, RESET_SLOTS_RETURN, RESET_SLOTS_TAKE } from './compute/wavefront/ResetSlotsKernel.js';
import { ZeroOutBufferKernel } from './compute/ZeroOutBufferKernel.js';
import { CopyBufferKernel } from './compute/CopyBufferKernel.js';
import { EquirectHdrInfoNode } from './EquirectHdrInfoNode.js';
import { EquirectBackgroundInfo } from './EquirectBackgroundInfo.js';
import { LightsInfoNode } from './LightsInfoNode.js';
import { rayDataStruct, traceQueuedRayStruct, intersectionResultStruct, rayQueueStruct, pixelQueueStruct } from './compute/wavefront/structs.js';
import { PathTracerBackend } from './PathTracerBackend.js';
import { FILTER_GLOSSY_DISABLED } from './nodes/material.wgsl.js';
import {
	PrimeSampleCountersKernel,
	TallySampleCountsKernel,
	SAMPLE_COUNTER_LENGTH,
	SAMPLE_COUNTER_MAX,
	SAMPLE_COUNTER_MIN,
	SAMPLE_COUNTER_PIXEL_COUNT,
	SAMPLE_COUNTER_TOTAL_HI,
	SAMPLE_COUNTER_TOTAL_LO,
	U32_RANGE,
} from './compute/TallySampleCountsKernel.js';

// set the buffers to the max possible size supported by default (128MB)
// TODO: this can be increased based on platform.
const MAX_BUFFER_SIZE = 134217728;

// the persistent path-slot pool is sized off the ray data struct; every other per-slot buffer
// ( queues, intersections ) is sized to the same count so a full pool can never overflow them
const MAX_RAY_DATA_COUNT = Math.floor( MAX_BUFFER_SIZE / ( rayDataStruct.getLength() * 4 ) );

const LOW_RES_ITERATIONS = 5;

// iterations a retiring slot is given to finish beyond its bounce limits before the pool shrinks
const DRAIN_MARGIN = 2;

export class WaveFrontPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.seed = 0;
		this.envInfo = new EquirectHdrInfoNode();
		this.backgroundInfo = new EquirectBackgroundInfo();
		this.lightsInfo = new LightsInfoNode();

		// The path slot pool, sized to the frame budget and resized in the render loop as the budget
		// changes. Every per-slot buffer is allocated to the same count so a full pool can never
		// overflow them.
		this.slotCount = 0;

		// persistent per-path state, one slot per in-flight path
		this.rayDataStorage = null;

		// append-only trace queues, prefixed by an atomic length header
		this.rayQueue = null;
		this.shadowRayQueue = null;

		// per-queue-slot trace results, indexed by the ray's position in its queue
		this.rayIntersectionsStorage = null;
		this.shadowRayIntersectionsStorage = null;

		// pixel indices waiting for a free path slot, sized to the resolution
		this.pixelQueue = null;

		// slots at or past this index finish their path and go idle, so a shrink can drain them
		this._spawnLimit = 0;

		// iterations left before every retiring slot is guaranteed idle and the pool can shrink
		this._drainIterations = 0;

		// reduction target for the per pixel sample counts, read back asynchronously
		this.sampleCountersStorage = new StorageBufferAttribute( new Uint32Array( SAMPLE_COUNTER_LENGTH ), SAMPLE_COUNTER_LENGTH );
		this.sampleCountersStorage.name = 'Sample Counters';
		this._samplesPromise = null;

		// kernels
		this.populatePixelIndicesKernel = new PopulatePixelIndicesKernel().setWorkgroupSize( 8, 8, 1 );
		this.logicKernel = new LogicKernel().setWorkgroupSize( 64, 1, 1 );
		this.materialKernel = new MaterialKernel().setWorkgroupSize( 64, 1, 1 );
		this.traceRayKernel = new TraceRayKernel().setWorkgroupSize( 64, 1, 1 );
		this.traceShadowRayKernel = new TraceShadowRayKernel().setWorkgroupSize( 64, 1, 1 );
		this.rayDispatchConverter = new QueueLengthToDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.shadowDispatchConverter = new QueueLengthToDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.primeSampleCountersKernel = new PrimeSampleCountersKernel().setWorkgroupSize( 1, 1, 1 );
		this.tallySampleCountsKernel = new TallySampleCountsKernel().setWorkgroupSize( 8, 8, 1 );

		// pool resizing: carry live slots into a reallocated pool and idle the rest
		this.resetSlotsKernel = new ResetSlotsKernel().setWorkgroupSize( 64, 1, 1 );
		this.copyRayDataKernel = new CopyBufferKernel( rayDataStruct ).setWorkgroupSize( 64, 1, 1 );

		// bind the shared env / lights providers so the kernels' proxies resolve even before they're set
		this.logicKernel.envInfo = this.envInfo;
		this.logicKernel.backgroundInfo = this.backgroundInfo;
		this.logicKernel.lightsInfo = this.lightsInfo;

		// clear kernels
		this.zeroDispatchKernel = new ZeroOutBufferKernel().setWorkgroupSize( 1, 1, 1 );

		// later
		this.volumeKernel = null;

	}

	resetSeed() {

		this.seed = 0;

	}

	reset() {

		super.reset();
		this._samplesPromise = null;

	}

	setBVHData( bvhData ) {

		this.materialKernel.bvhData = bvhData;
		this.materialKernel.needsUpdate = true;

		this.traceRayKernel.bvhData = bvhData;
		this.traceRayKernel.needsUpdate = true;

		this.traceShadowRayKernel.bvhData = bvhData;
		this.traceShadowRayKernel.needsUpdate = true;

		this.reset();

	}

	rebuild() {

		super.rebuild();

		// MaterialKernel bakes in the camera ray function, so a camera swap needs a recompile
		this.materialKernel.needsUpdate = true;
		this.reset();

	}

	setRandom( random ) {

		this.logicKernel.context.random = random;
		this.logicKernel.needsUpdate = true;

		this.materialKernel.context.random = random;
		this.materialKernel.needsUpdate = true;

		this.traceRayKernel.context.random = random;
		this.traceRayKernel.needsUpdate = true;

		this.traceShadowRayKernel.context.random = random;
		this.traceShadowRayKernel.needsUpdate = true;

		this.reset();

	}

	setMaterial( material ) {

		this.materialKernel.material = material.getData();
		this.materialKernel.needsUpdate = true;
		this.reset();

	}

	setFilterGlossy( value ) {

		// the kernel takes the inverted threshold, mirroring Cycles
		this.materialKernel.filterGlossy = value === 0 ? FILTER_GLOSSY_DISABLED : 1 / value;
		this.reset();

	}

	setClamping( direct, indirect ) {

		this.logicKernel.clampDirect = direct;
		this.logicKernel.clampIndirect = indirect;
		this.reset();

	}

	setTransmissiveBackground( value ) {

		this.logicKernel.transmissiveBackground = value;
		this.reset();

	}

	setEnvironment( envMap ) {

		this.envInfo.updateFrom( envMap );

	}

	setLights( lights ) {

		this.lightsInfo.updateFrom( this.renderer, lights );
		this.reset();

	}

	setEnvironmentParams( envMapIntensity, envMapRotation ) {

		const { envInfo } = this;
		const rotationMatrix = new Matrix4().makeRotationFromEuler( envMapRotation ).invert();
		envInfo.rotationNode.value.setFromMatrix4( rotationMatrix );
		envInfo.intensityNode.value = envMapIntensity;

	}

	setMultipleImportanceSampling( enabled ) {

		this.logicKernel.misEnabled = enabled ? 1 : 0;
		this.reset();

	}

	setBackground( background ) {

		const { backgroundInfo } = this;
		backgroundInfo.dispose();
		backgroundInfo.map = background;

	}

	setBackgroundParams(
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

		const { backgroundInfo } = this;
		const rotationMatrix = new Matrix4().makeRotationFromEuler( backgroundRotation ).invert();
		backgroundInfo.rotationNode.value.copy( rotationMatrix );
		backgroundInfo.intensity = backgroundIntensity;
		backgroundInfo.blur = backgroundBlurriness;

	}

	dispose() {

		super.dispose();

		this.envInfo.dispose();
		this.lightsInfo.dispose();

		this.rayDataStorage?.dispose();
		this.rayQueue?.dispose();
		this.shadowRayQueue?.dispose();
		this.rayIntersectionsStorage?.dispose();
		this.shadowRayIntersectionsStorage?.dispose();
		this.sampleCountersStorage.dispose();
		this.pixelQueue?.dispose();

		// TODO: the dispatch converters own their indirect dispatch buffers, they should dispose of them themselves
		this.rayDispatchConverter.outputDispatch.dispose();
		this.shadowDispatchConverter.outputDispatch.dispose();

	}

	// The queue holds every pixel not owned by a slot. It is sized to the full pixel count so slots
	// retired by a shrink can always return theirs.
	_updatePixelQueue( width, height ) {

		const size = pixelQueueStruct.getLength() + Math.max( width * height, 1 );
		if ( ! this.pixelQueue || this.pixelQueue.array.length < size ) {

			this.pixelQueue?.dispose();
			this.pixelQueue = new StorageBufferAttribute( new Float32Array( size ), size );
			this.pixelQueue.name = 'Pixel Queue';

			// the queue buffer object changed, so kernels bound to it must rebuild
			this.materialKernel.pixelQueue = this.pixelQueue;
			this.materialKernel.needsUpdate = true;
			this.populatePixelIndicesKernel.pixelQueue = this.pixelQueue;
			this.populatePixelIndicesKernel.needsUpdate = true;
			this.resetSlotsKernel.pixelQueue = this.pixelQueue;
			this.resetSlotsKernel.needsUpdate = true;

		}

	}

	// Reallocates the per slot buffers to "count" slots, carrying the first "copyCount" slots of ray
	// data over. The queues and trace results only live within a frame, so they start empty.
	_resizePool( count, copyCount ) {

		const { renderer } = this;

		const rayDataStorage = new StorageBufferAttribute( count, rayDataStruct.getLength() );
		rayDataStorage.name = 'Ray Data';

		const queueSize = rayQueueStruct.getLength() + count * traceQueuedRayStruct.getLength();
		const rayQueue = new StorageBufferAttribute( new Float32Array( queueSize ), queueSize );
		rayQueue.name = 'Ray Queue';

		const shadowRayQueue = new StorageBufferAttribute( new Float32Array( queueSize ), queueSize );
		shadowRayQueue.name = 'Shadow Ray Queue';

		const rayIntersectionsStorage = new StorageBufferAttribute( count, intersectionResultStruct.getLength() );
		rayIntersectionsStorage.name = 'Ray Intersections';

		const shadowRayIntersectionsStorage = new StorageBufferAttribute( count, intersectionResultStruct.getLength() );
		shadowRayIntersectionsStorage.name = 'Shadow Ray Intersections';

		if ( copyCount > 0 ) {

			const { copyRayDataKernel } = this;
			copyRayDataKernel.source = this.rayDataStorage;
			copyRayDataKernel.target = rayDataStorage;
			copyRayDataKernel.count = copyCount;
			renderer.compute( copyRayDataKernel.kernel, copyRayDataKernel.getDispatchSize( copyCount, 1, 1 ) );

		}

		this.rayDataStorage?.dispose();
		this.rayQueue?.dispose();
		this.shadowRayQueue?.dispose();
		this.rayIntersectionsStorage?.dispose();
		this.shadowRayIntersectionsStorage?.dispose();

		this.rayDataStorage = rayDataStorage;
		this.rayQueue = rayQueue;
		this.shadowRayQueue = shadowRayQueue;
		this.rayIntersectionsStorage = rayIntersectionsStorage;
		this.shadowRayIntersectionsStorage = shadowRayIntersectionsStorage;
		this.slotCount = count;

		// the buffer objects changed, so kernels bound to them must rebuild
		this.logicKernel.needsUpdate = true;
		this.materialKernel.needsUpdate = true;
		this.traceRayKernel.needsUpdate = true;
		this.traceShadowRayKernel.needsUpdate = true;
		this.populatePixelIndicesKernel.needsUpdate = true;
		this.resetSlotsKernel.needsUpdate = true;

	}

	// Idles the slots in [ start, end ), returning their pixels to the queue or taking new ones
	_resetSlots( start, end, mode ) {

		const { renderer, resetSlotsKernel } = this;
		if ( end <= start ) {

			return;

		}

		resetSlotsKernel.rayDataStorage = this.rayDataStorage;
		resetSlotsKernel.pixelQueue = this.pixelQueue;
		resetSlotsKernel.start = start;
		resetSlotsKernel.end = end;
		resetSlotsKernel.mode = mode;
		renderer.compute( resetSlotsKernel.kernel, resetSlotsKernel.getDispatchSize( end - start, 1, 1 ) );

	}

	// The slot count the current budget asks for, capped by the pool limit and the pixel count
	_getRequestedSlotCount( pixelCount ) {

		return Math.min( MAX_RAY_DATA_COUNT, pixelCount, Math.max( 1, Math.floor( this.frameBudget ) ) );

	}

	// Applies a budget change. Growing carries the live pool into a larger one and gives the new
	// slots pixels. Shrinking stops spawning past the new budget, and once every retiring slot has
	// had time to finish its path, hands their pixels back and trims the pool.
	_applyBudget( pixelCount ) {

		const requested = this._getRequestedSlotCount( pixelCount );
		if ( requested > this.slotCount ) {

			const previousCount = this.slotCount;
			this._resizePool( requested, previousCount );
			this._resetSlots( previousCount, requested, RESET_SLOTS_TAKE );

		}

		if ( requested < this._spawnLimit ) {

			this._drainIterations = this.maxBounces + this.maxTransparentBounces + DRAIN_MARGIN;

		}

		this._spawnLimit = requested;

		if ( this._drainIterations > 0 && -- this._drainIterations === 0 && requested < this.slotCount ) {

			this._resetSlots( requested, this.slotCount, RESET_SLOTS_RETURN );
			this._resizePool( requested, requested );

		}

	}

	*createRenderTask() {

		const {
			renderer,

			logicKernel,
			materialKernel,
			traceRayKernel,
			traceShadowRayKernel,
			rayDispatchConverter,
			shadowDispatchConverter,
			zeroDispatchKernel,
			populatePixelIndicesKernel,
		} = this;

		// a resize resets, recreating this task, so the dimensions and pixel queue hold for its
		// lifetime. The slot pool starts tight, at the budget, and is resized in the loop below.
		const targetDimensions = new Vector2();
		this.getSize( targetDimensions );

		const pixelCount = targetDimensions.x * targetDimensions.y;
		const rayCount = this._getRequestedSlotCount( pixelCount );
		if ( rayCount !== this.slotCount ) {

			// nothing is in flight at the start of a task, so no slots carry over
			this._resizePool( rayCount, 0 );

		}

		this._spawnLimit = rayCount;
		this._drainIterations = 0;

		// referenced via "this" since the buffers may be replaced here and in the loop
		this._updatePixelQueue( targetDimensions.x, targetDimensions.y );

		// reset the trace queues — only the length header needs zeroing
		zeroDispatchKernel.target = this.rayQueue;
		renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

		zeroDispatchKernel.target = this.shadowRayQueue;
		renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

		// assign every path slot a pixel and park the overflow pixels in the pixel queue
		populatePixelIndicesKernel.rayDataStorage = this.rayDataStorage;
		populatePixelIndicesKernel.pixelQueue = this.pixelQueue;
		populatePixelIndicesKernel.frameBudget = rayCount;
		populatePixelIndicesKernel.targetDimensions.copy( targetDimensions );
		renderer.compute( populatePixelIndicesKernel.kernel, populatePixelIndicesKernel.getDispatchSize( targetDimensions.x, targetDimensions.y, 1 ) );

		// advance the sequence once per task so each render pass starts from fresh
		// noise unless "stableNoise" has reset it
		this.seed ++;

		while ( true ) {

			// TODO: this only makes sense if we can cap the number rays per iteration to the full
			// frame
			const iter = this.lowResMode ? Math.min( this.maxBounces, LOW_RES_ITERATIONS ) : 1;

			for ( let i = 0; i < iter; i ++ ) {

				// Swap targets to support devices without <rgba32float, read_write> textures
				// Copy latest data to a new outputTarget to keep the appearance
				// TODO: this full resolution copy runs every frame - remove it by writing terminated
				// samples to both targets or gating the swap on devices that support read_write
				renderer.copyTextureToTexture( this.outputTarget, this.prevOutputTarget );
				[ this.outputTarget, this.prevOutputTarget ] = [ this.prevOutputTarget, this.outputTarget ];
				logicKernel.prevOutputTarget = this.prevOutputTarget;
				logicKernel.outputTarget = this.outputTarget;
				logicKernel.sampleCountTarget = this.sampleCountTarget;

				// Step 1: resolve last frame's trace results — accumulate NEE / emission / env, terminate
				// finished paths into the output, and pick the next NEE light for each live path
				logicKernel.rayDataStorage = this.rayDataStorage;
				logicKernel.rayIntersectionsStorage = this.rayIntersectionsStorage;
				logicKernel.shadowRayIntersectionsStorage = this.shadowRayIntersectionsStorage;
				logicKernel.maxBounces = this.maxBounces;
				logicKernel.rayCount = this.slotCount;
				renderer.compute( logicKernel.kernel, logicKernel.getDispatchSize( this.slotCount, 1, 1 ) );

				// the trace results are consumed, so only the slot state has to survive a resize
				this._applyBudget( pixelCount );

				const {
					rayDataStorage,
					rayQueue,
					shadowRayQueue,
					rayIntersectionsStorage,
					shadowRayIntersectionsStorage,
					slotCount,
					maxTransparentBounces,
				} = this;

				// Step 2: reset the trace queues for this frame's population
				zeroDispatchKernel.target = rayQueue;
				renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

				zeroDispatchKernel.target = shadowRayQueue;
				renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

				// Step 3: evaluate materials — spawn camera rays for freed slots, sample the bsdf, and
				// enqueue this frame's bounce + shadow rays
				materialKernel.rayDataStorage = rayDataStorage;
				materialKernel.rayQueue = rayQueue;
				materialKernel.shadowRayQueue = shadowRayQueue;
				materialKernel.pixelQueue = this.pixelQueue;
				materialKernel.sampleCountTarget = this.sampleCountTarget;
				materialKernel.seed = this.seed;
				materialKernel.maxSamples = this.maxSamples;
				materialKernel.rayCount = slotCount;
				materialKernel.spawnLimit = this._spawnLimit;
				materialKernel.maxTransparentBounces = maxTransparentBounces;
				materialKernel.maxBounces = this.maxBounces;
				materialKernel.targetDimensions.copy( targetDimensions );
				renderer.compute( materialKernel.kernel, materialKernel.getDispatchSize( slotCount, 1, 1 ) );

				// Step 4: convert the queue lengths into indirect dispatch sizes and trace
				rayDispatchConverter.queue = rayQueue;
				renderer.compute( rayDispatchConverter.kernel, [ 1, 1, 1 ] );

				traceRayKernel.rayQueue = rayQueue;
				traceRayKernel.rayIntersectionsStorage = rayIntersectionsStorage;
				renderer.compute( traceRayKernel.kernel, rayDispatchConverter.outputDispatch );

				shadowDispatchConverter.queue = shadowRayQueue;
				renderer.compute( shadowDispatchConverter.kernel, [ 1, 1, 1 ] );

				traceShadowRayKernel.shadowRayQueue = shadowRayQueue;
				traceShadowRayKernel.shadowRayIntersectionsStorage = shadowRayIntersectionsStorage;
				renderer.compute( traceShadowRayKernel.kernel, shadowDispatchConverter.outputDispatch );

			}

			yield;

		}

	}

	// Reduces the per pixel sample counts and reads them back. Runs a full resolution pass, so it
	// only happens when asked for.
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

			return { min: 0, max: 0, avg: 0 };

		}

		primeSampleCountersKernel.counters = sampleCountersStorage;
		renderer.compute( primeSampleCountersKernel.kernel, [ 1, 1, 1 ] );

		tallySampleCountsKernel.counters = sampleCountersStorage;
		tallySampleCountsKernel.sampleCountTarget = sampleCountTarget;
		renderer.compute(
			tallySampleCountsKernel.kernel,
			tallySampleCountsKernel.getDispatchSize( sampleCountTarget.width, sampleCountTarget.height ),
		);

		const buffer = await renderer.getArrayBufferAsync( sampleCountersStorage );
		const counters = new Uint32Array( buffer );
		const pixelCount = counters[ SAMPLE_COUNTER_PIXEL_COUNT ];

		// no camera ray has been dispatched yet, so there is nothing to average over
		if ( pixelCount === 0 ) {

			return { min: 0, max: 0, avg: 0 };

		}

		// the total is accumulated as a split 64 bit value to survive high sample counts
		const total = counters[ SAMPLE_COUNTER_TOTAL_HI ] * U32_RANGE + counters[ SAMPLE_COUNTER_TOTAL_LO ];

		return {
			min: counters[ SAMPLE_COUNTER_MIN ],
			max: counters[ SAMPLE_COUNTER_MAX ],
			avg: total / pixelCount,
		};

	}

}
