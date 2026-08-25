import { Matrix4, StorageBufferAttribute, Vector2 } from 'three/webgpu';
import { PopulatePixelIndicesKernel } from './compute/wavefront/PopulatePixelIndicesKernel.js';
import { LogicKernel } from './compute/wavefront/LogicKernel.js';
import { MaterialKernel } from './compute/wavefront/MaterialKernel.js';
import { TraceRayKernel } from './compute/wavefront/TraceRayKernel.js';
import { TraceShadowRayKernel } from './compute/wavefront/TraceShadowRayKernel.js';
import { QueueLengthToDispatchKernel } from './compute/wavefront/QueueLengthToDispatchKernel.js';
import { ZeroOutBufferKernel } from './compute/ZeroOutBufferKernel.js';
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

export class WaveFrontPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.tiles = new Vector2( 3, 3 );
		this.seed = 0;
		this.envInfo = new EquirectHdrInfoNode();
		this.backgroundInfo = new EquirectBackgroundInfo();
		this.lightsInfo = new LightsInfoNode();

		// persistent per-path state, one slot per in-flight path
		this.rayData = new StorageBufferAttribute( MAX_RAY_DATA_COUNT, rayDataStruct.getLength() );
		this.rayData.name = 'Ray Data';

		// append-only trace queues, prefixed by an atomic length header
		const queueSize = rayQueueStruct.getLength() + MAX_RAY_DATA_COUNT * traceQueuedRayStruct.getLength();
		this.rayQueue = new StorageBufferAttribute( new Float32Array( queueSize ), queueSize );
		this.rayQueue.name = 'Ray Queue';

		this.shadowRayQueue = new StorageBufferAttribute( new Float32Array( queueSize ), queueSize );
		this.shadowRayQueue.name = 'Shadow Ray Queue';

		// per-queue-slot trace results, indexed by the ray's position in its queue
		this.rayIntersections = new StorageBufferAttribute( MAX_RAY_DATA_COUNT, intersectionResultStruct.getLength() );
		this.rayIntersections.name = 'Ray Intersections';

		this.shadowRayIntersections = new StorageBufferAttribute( MAX_RAY_DATA_COUNT, intersectionResultStruct.getLength() );
		this.shadowRayIntersections.name = 'Shadow Ray Intersections';

		// overflow pixel indices waiting for a free path slot, lazily sized to the resolution
		this.pixelQueue = null;

		// reduction target for the per pixel sample counts, read back asynchronously
		this.sampleCounters = new StorageBufferAttribute( new Uint32Array( SAMPLE_COUNTER_LENGTH ), SAMPLE_COUNTER_LENGTH );
		this.sampleCounters.name = 'Sample Counters';
		this._samplesPromise = null;

		// kernels
		this.populatePixelIndicesKernel = new PopulatePixelIndicesKernel().setWorkgroupSize( 8, 8, 1 );
		this.logicKernel = new LogicKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.materialKernel = new MaterialKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.traceRayKernel = new TraceRayKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.traceShadowRayKernel = new TraceShadowRayKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.rayDispatchConverter = new QueueLengthToDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.shadowDispatchConverter = new QueueLengthToDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.primeSampleCountersKernel = new PrimeSampleCountersKernel().setWorkgroupSize( 1, 1, 1 );
		this.tallySampleCountsKernel = new TallySampleCountsKernel().setWorkgroupSize( 8, 8, 1 );

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

	setBVHData( bvhData ) {

		this.materialKernel.bvhData = bvhData;
		this.materialKernel.needsUpdate = true;

		this.traceRayKernel.bvhData = bvhData;
		this.traceRayKernel.needsUpdate = true;

		this.traceShadowRayKernel.bvhData = bvhData;
		this.traceShadowRayKernel.needsUpdate = true;

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

	setLights( lights, iesTextures, iesTexture ) {

		this.lightsInfo.updateFrom( lights, iesTextures );
		this.lightsInfo.setIesProfiles( iesTexture );
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

	setTiles( tiles ) {

		this.tiles.copy( tiles );

	}

	dispose() {

		super.dispose();

		// TODO: dispose of all buffers
		this.envInfo.dispose();
		this.lightsInfo.dispose();

	}

	_updatePixelQueue( width, height ) {

		const overflowCount = Math.max( 0, width * height - MAX_RAY_DATA_COUNT );
		const size = pixelQueueStruct.getLength() + Math.max( overflowCount, 1 );
		if ( ! this.pixelQueue || this.pixelQueue.array.length < size ) {

			this.pixelQueue = new StorageBufferAttribute( new Float32Array( size ), size );
			this.pixelQueue.name = 'Pixel Queue';

			// the queue buffer object changed, so kernels bound to it must rebuild
			this.materialKernel.pixelQueue = this.pixelQueue;
			this.materialKernel.needsUpdate = true;
			this.populatePixelIndicesKernel.pixelQueue = this.pixelQueue;
			this.populatePixelIndicesKernel.needsUpdate = true;

		}

	}

	reset() {

		const {
			renderer,

			zeroDispatchKernel,
			populatePixelIndicesKernel,

			rayData,
			rayQueue,
			shadowRayQueue,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		super.reset();

		// reset the trace queues — only the length header needs zeroing
		zeroDispatchKernel.target = rayQueue;
		renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

		zeroDispatchKernel.target = shadowRayQueue;
		renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

		// assign every path slot a pixel and park the overflow pixels in the pixel queue
		const { width, height } = this.sampleCountTarget;
		this._updatePixelQueue( width, height );

		populatePixelIndicesKernel.rayData = rayData;
		populatePixelIndicesKernel.pixelQueue = this.pixelQueue;
		populatePixelIndicesKernel.targetDimensions.set( width, height );
		renderer.compute( populatePixelIndicesKernel.kernel, populatePixelIndicesKernel.getDispatchSize( width, height, 1 ) );

	}

	*createRenderTask() {

		const {
			renderer,

			rayData,
			rayQueue,
			shadowRayQueue,
			rayIntersections,
			shadowRayIntersections,

			logicKernel,
			materialKernel,
			traceRayKernel,
			traceShadowRayKernel,
			rayDispatchConverter,
			shadowDispatchConverter,
			zeroDispatchKernel,
		} = this;

		const targetDimensions = new Vector2();
		let samples = this.samples;

		while ( true ) {

			const iter = this.lowResMode ? 5 : 1;
			for ( let i = 0; i < iter; i ++ ) {

				this.getSize( targetDimensions );
				const rayCount = Math.min( MAX_RAY_DATA_COUNT, targetDimensions.x * targetDimensions.y );

				// Swap targets to support devices without <rgba32float, read_write> textures
				// Copy latest data to a new outputTarget to keep the appearance
				renderer.copyTextureToTexture( this.outputTarget, this.prevOutputTarget );
				[ this.outputTarget, this.prevOutputTarget ] = [ this.prevOutputTarget, this.outputTarget ];
				logicKernel.prevOutputTarget = this.prevOutputTarget;
				logicKernel.outputTarget = this.outputTarget;
				logicKernel.sampleCountTarget = this.sampleCountTarget;

				// Step 1: resolve last frame's trace results — accumulate NEE / emission / env, terminate
				// finished paths into the output, and pick the next NEE light for each live path
				logicKernel.rayData = rayData;
				logicKernel.rayIntersections = rayIntersections;
				logicKernel.shadowRayIntersections = shadowRayIntersections;
				logicKernel.bounces = this.bounces;
				renderer.compute( logicKernel.kernel, logicKernel.getDispatchSize( rayCount, 1, 1 ) );

				// Step 2: reset the trace queues for this frame's population
				zeroDispatchKernel.target = rayQueue;
				renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

				zeroDispatchKernel.target = shadowRayQueue;
				renderer.compute( zeroDispatchKernel.kernel, [ 1 ] );

				// Step 3: evaluate materials — spawn camera rays for freed slots, sample the bsdf, and
				// enqueue this frame's bounce + shadow rays
				materialKernel.rayData = rayData;
				materialKernel.rayQueue = rayQueue;
				materialKernel.shadowRayQueue = shadowRayQueue;
				materialKernel.pixelQueue = this.pixelQueue;
				materialKernel.sampleCountTarget = this.sampleCountTarget;
				materialKernel.seed = this.seed;
				materialKernel.maxSamples = this.maxSamples;
				materialKernel.targetDimensions.copy( targetDimensions );
				renderer.compute( materialKernel.kernel, materialKernel.getDispatchSize( rayCount, 1, 1 ) );

				// Step 4: convert the queue lengths into indirect dispatch sizes and trace
				rayDispatchConverter.queue = rayQueue;
				renderer.compute( rayDispatchConverter.kernel, [ 1, 1, 1 ] );

				traceRayKernel.rayQueue = rayQueue;
				traceRayKernel.rayIntersections = rayIntersections;
				renderer.compute( traceRayKernel.kernel, rayDispatchConverter.outputDispatch );

				shadowDispatchConverter.queue = shadowRayQueue;
				renderer.compute( shadowDispatchConverter.kernel, [ 1, 1, 1 ] );

				traceShadowRayKernel.shadowRayQueue = shadowRayQueue;
				traceShadowRayKernel.shadowRayIntersections = shadowRayIntersections;
				renderer.compute( traceShadowRayKernel.kernel, shadowDispatchConverter.outputDispatch );

				this.seed ++;
				samples += rayCount / ( targetDimensions.x * targetDimensions.y * this.bounces );
				this.samples = Math.floor( samples );

			}

			yield;

		}

	}

	// Reduces the per pixel sample counts and reads them back. Runs a full resolution pass, so it
	// only happens when asked for.
	getSampleCountsAsync() {

		// share the in flight measurement rather than dispatching another
		if ( this._samplesPromise === null ) {

			this._samplesPromise = this._measureSampleCounts().finally( () => {

				this._samplesPromise = null;

			} );

		}

		return this._samplesPromise;

	}

	async _measureSampleCounts() {

		const {
			renderer,
			sampleCountTarget,
			sampleCounters,
			primeSampleCountersKernel,
			tallySampleCountsKernel,
		} = this;

		if ( ! renderer.initialized || this.lowResMode ) {

			return { min: 0, max: 0, avg: 0 };

		}

		primeSampleCountersKernel.counters = sampleCounters;
		renderer.compute( primeSampleCountersKernel.kernel, [ 1, 1, 1 ] );

		tallySampleCountsKernel.counters = sampleCounters;
		tallySampleCountsKernel.sampleCountTarget = sampleCountTarget;
		renderer.compute(
			tallySampleCountsKernel.kernel,
			tallySampleCountsKernel.getDispatchSize( sampleCountTarget.width, sampleCountTarget.height ),
		);

		const buffer = await renderer.getArrayBufferAsync( sampleCounters );
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
