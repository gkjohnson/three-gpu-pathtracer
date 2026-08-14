import { Matrix4, IndirectStorageBufferAttribute, StorageBufferAttribute, Vector2 } from 'three/webgpu';
import { PrimeRayGenerationDispatchKernel } from './compute/wavefront/PrimeRayGenerationDispatchKernel.js';
import { RayGenerationKernel } from './compute/wavefront/RayGenerationKernel.js';
import { RayIntersectionKernel } from './compute/wavefront/RayIntersectionKernel.js';
import { UpdateRayQueueParamsKernel } from './compute/wavefront/UpdateRayQueueParamsKernel.js';
import { ZeroOutBufferKernel } from './compute/ZeroOutBufferKernel.js';
import { ProcessHitsKernel } from './compute/wavefront/ProcessHitsKernel.js';
import { LightConnectionKernel } from './compute/wavefront/LightConnectionKernel.js';
import { EquirectHdrInfoNode } from './EquirectHdrInfoNode.js';
import { EquirectBackgroundInfo } from './EquirectBackgroundInfo.js';
import { LightsInfoNode } from './LightsInfoNode.js';
import { QueueLengthToDispatchKernel } from './compute/wavefront/QueueLengthToDispatchKernel.js';
import { FILTER_GLOSSY_DISABLED } from './nodes/material.wgsl.js';
import { queuedHitStruct, queuedRayStruct, rayQueueStruct, hitQueueStruct } from './compute/wavefront/structs.js';
import { PathTracerBackend } from './PathTracerBackend.js';

// set the buffers to the max possible size supported by default (128MB)
// TODO: this can be increased based on platform.
const RAYS_TO_PROCESS = 250000;
const MAX_BUFFER_SIZE = 134217728;

// Both queues use the same element count so the hit queue can never overflow - every intersected
// ray produces at most one hit, so hits are bounded by the ray queue capacity.
// subtract 16 bytes for the queue's start/end cursor header that precedes the elements
const MAX_RAY_COUNT = Math.floor( ( MAX_BUFFER_SIZE - 16 ) / ( queuedRayStruct.getLength() * 4 ) );
const MAX_HIT_COUNT = Math.floor( ( MAX_BUFFER_SIZE - 16 ) / ( queuedHitStruct.getLength() * 4 ) );

// Make the buffer size as big as possible so the tile of rays can fit.
// TODO: This should be adjusted so it can be smaller and arbitrary tile size cannot cause problems
const MAX_QUEUE_COUNT = Math.min( MAX_RAY_COUNT, MAX_HIT_COUNT );

export class WaveFrontPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.tiles = new Vector2( 3, 3 );
		this.envInfo = new EquirectHdrInfoNode();
		this.backgroundInfo = new EquirectBackgroundInfo();
		this.lightsInfo = new LightsInfoNode();

		const rayQueueSize = 4 + MAX_QUEUE_COUNT * queuedRayStruct.getLength();
		this.rayQueue = new StorageBufferAttribute( new Float32Array( rayQueueSize ), rayQueueSize );
		this.rayQueue.name = 'Ray Queue';

		const hitQueueSize = 4 + MAX_QUEUE_COUNT * queuedHitStruct.getLength();
		this.hitQueue = new StorageBufferAttribute( new Float32Array( hitQueueSize ), hitQueueSize );
		this.hitQueue.name = 'Hit Queue';

		// dispatches
		this.tileIndexBuffer = new IndirectStorageBufferAttribute( 2, 1 );
		this.rayGenerationDispatch = new IndirectStorageBufferAttribute( 3, 1 );
		this.hitProcessDispatch = new IndirectStorageBufferAttribute( 3, 1 );

		// kernels
		this.primeRayGenerationDispatchKernel = new PrimeRayGenerationDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.enqueueRaysKernel = new RayGenerationKernel( ).setWorkgroupSize( 8, 8, 1 );
		this.rayIntersectionKernel = new RayIntersectionKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.updateRayQueueParamsKernel = new UpdateRayQueueParamsKernel().setWorkgroupSize( 1, 1, 1 );
		this.hitProcessKernel = new ProcessHitsKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.lightConnectionKernel = new LightConnectionKernel( ).setWorkgroupSize( 64, 1, 1 );
		this.rayDispatchConverter = new QueueLengthToDispatchKernel( rayQueueStruct ).setWorkgroupSize( 1, 1, 1 );
		this.hitDispatchConverter = new QueueLengthToDispatchKernel( hitQueueStruct ).setWorkgroupSize( 1, 1, 1 );

		// bind the shared env / lights providers so the kernels' proxies resolve even before they're set
		this.rayIntersectionKernel.envInfo = this.envInfo;
		this.lightConnectionKernel.envInfo = this.envInfo;
		this.rayIntersectionKernel.backgroundInfo = this.backgroundInfo;
		this.rayIntersectionKernel.lightsInfo = this.lightsInfo;
		this.lightConnectionKernel.lightsInfo = this.lightsInfo;

		// clear kernels
		this.zeroDispatchKernel = new ZeroOutBufferKernel().setWorkgroupSize( 1, 1, 1 );

		// later
		this.volumeKernel = null;

	}

	resetSeed() {

		this.enqueueRaysKernel.seed = 0;

	}

	setBVHData( bvhData ) {

		this.enqueueRaysKernel.bvhData = bvhData;

		this.rayIntersectionKernel.bvhData = bvhData;

		this.hitProcessKernel.bvhData = bvhData;

		this.lightConnectionKernel.bvhData = bvhData;

		this.rebuild();

	}

	rebuild() {

		super.rebuild();
		this.enqueueRaysKernel.needsUpdate = true;
		this.rayIntersectionKernel.needsUpdate = true;
		this.hitProcessKernel.needsUpdate = true;
		this.lightConnectionKernel.needsUpdate = true;
		this.reset();

	}

	setRandom( random ) {

		this.enqueueRaysKernel.context.random = random;
		this.enqueueRaysKernel.needsUpdate = true;

		this.rayIntersectionKernel.context.random = random;
		this.rayIntersectionKernel.needsUpdate = true;

		this.hitProcessKernel.context.random = random;
		this.hitProcessKernel.needsUpdate = true;

		this.lightConnectionKernel.context.random = random;
		this.lightConnectionKernel.needsUpdate = true;

		this.reset();

	}

	setMaterial( material ) {

		this.hitProcessKernel.material = material.getData();
		this.hitProcessKernel.needsUpdate = true;

		this.lightConnectionKernel.material = material.getData();
		this.lightConnectionKernel.needsUpdate = true;
		this.reset();

	}

	setFilterGlossy( value ) {

		// the kernel takes the inverted threshold, mirroring Cycles
		const filterGlossy = value === 0 ? FILTER_GLOSSY_DISABLED : 1 / value;
		this.hitProcessKernel.filterGlossy = filterGlossy;
		this.lightConnectionKernel.filterGlossy = filterGlossy;
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

		const value = enabled ? 1 : 0;
		this.rayIntersectionKernel.misEnabled = value;
		this.lightConnectionKernel.misEnabled = value;
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

	setTransmissiveBackground( value ) {

		this.rayIntersectionKernel.transmissiveBackground = value;
		this.reset();

	}

	setTiles( tiles ) {

		this.tiles.copy( tiles );

	}

	getTileSize( target ) {

		this.getSize( target ).divide( this.tiles ).ceil();

		return target;

	}

	dispose() {

		super.dispose();

		// TODO: dispose of all buffers
		this.envInfo.dispose();
		this.lightsInfo.dispose();

	}

	reset() {

		const {
			renderer,

			sampleCountClearKernel,
			zeroDispatchKernel,

			sampleCountTarget,

			hitProcessDispatch,
			rayGenerationDispatch,
			rayQueue,
			hitQueue,
			tileIndexBuffer,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		super.reset();

		const { width, height } = sampleCountTarget;
		const dispatchSize = sampleCountClearKernel.getDispatchSize( width, height );

		// clear buffers
		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		// clear queue cursors — only the 2-cursor header at the head of each queue buffer needs zeroing
		zeroDispatchKernel.target = hitQueue;
		renderer.compute( zeroDispatchKernel.kernel, [ 2 ] );

		zeroDispatchKernel.target = rayQueue;
		renderer.compute( zeroDispatchKernel.kernel, [ 2 ] );

		// clear dispatch sizes
		zeroDispatchKernel.target = hitProcessDispatch;
		renderer.compute( zeroDispatchKernel.kernel, [ hitProcessDispatch.count ] );

		zeroDispatchKernel.target = rayGenerationDispatch;
		renderer.compute( zeroDispatchKernel.kernel, [ rayGenerationDispatch.count ] );

		zeroDispatchKernel.target = tileIndexBuffer;
		renderer.compute( zeroDispatchKernel.kernel, [ tileIndexBuffer.count ] );

	}

	*createRenderTask() {

		const {
			renderer,
			bounces,

			tiles,
			sampleCountTarget,

			rayQueue,
			hitQueue,
			rayGenerationDispatch,
			// hitProcessDispatch,
			tileIndexBuffer,

			primeRayGenerationDispatchKernel,
			enqueueRaysKernel,
			rayIntersectionKernel,
			updateRayQueueParamsKernel,
			hitProcessKernel,
			lightConnectionKernel,
			rayDispatchConverter,
			hitDispatchConverter,

			lowResMode
		} = this;

		primeRayGenerationDispatchKernel.tileOffset = 0;

		// advance the sequence once per task so each render pass starts from fresh
		// noise unless "stableNoise" has reset it
		enqueueRaysKernel.seed ++;

		const tileSize = new Vector2();
		const samplesPerIteration = RAYS_TO_PROCESS / ( sampleCountTarget.width * sampleCountTarget.height * bounces );
		const iter = lowResMode ? 5 : 1;
		let samples = 0;

		while ( true ) {

			for ( let i = 0; i < iter; i ++ ) {

				this.getTileSize( tileSize );

				// Swap targets to support devices without <rgba32float, read_write> textures
				// Copy latest data to a new outputTarget to keep the appearance
				renderer.copyTextureToTexture( this.outputTarget, this.prevOutputTarget );
				[ this.outputTarget, this.prevOutputTarget ] = [ this.prevOutputTarget, this.outputTarget ];
				rayIntersectionKernel.prevOutputTarget = this.prevOutputTarget;
				rayIntersectionKernel.outputTarget = this.outputTarget;
				hitProcessKernel.prevOutputTarget = this.prevOutputTarget;
				hitProcessKernel.outputTarget = this.outputTarget;

				// Step 1: Top up the ray queue
				// set up the ray prime kernel
				primeRayGenerationDispatchKernel.rayWorkGroupSize.set( 8, 8, 1 );
				primeRayGenerationDispatchKernel.tileCount.copy( tiles );
				primeRayGenerationDispatchKernel.tileSize.copy( tileSize );
				primeRayGenerationDispatchKernel.rayQueue = rayQueue;
				primeRayGenerationDispatchKernel.hitQueue = hitQueue;
				primeRayGenerationDispatchKernel.outputTileIndex = tileIndexBuffer;
				primeRayGenerationDispatchKernel.outputDispatch = rayGenerationDispatch;

				// set up the ray generation kernel
				enqueueRaysKernel.tileIndexBuffer = tileIndexBuffer;
				enqueueRaysKernel.tileSize.copy( tileSize );
				enqueueRaysKernel.rayQueue = rayQueue;
				enqueueRaysKernel.sampleCountTarget = sampleCountTarget;

				for ( let i = 0; i < tiles.x * tiles.y; i ++ ) {

					// TODO: skip rays that have converged, have reach max samples
					renderer.compute( primeRayGenerationDispatchKernel.kernel, [ 1, 1, 1 ] );
					renderer.compute( enqueueRaysKernel.kernel, rayGenerationDispatch );
					primeRayGenerationDispatchKernel.tileOffset = 1;

				}

				// Step 2: run intersections over a subset of the queued rays, add color for
				// terminated rays, add material handling to a dedicated queue
				rayDispatchConverter.queue = rayQueue;
				rayDispatchConverter.maxCount = RAYS_TO_PROCESS;
				renderer.compute( rayDispatchConverter.kernel, [ 1, 1, 1 ] );

				rayIntersectionKernel.sampleCountTarget = sampleCountTarget;
				rayIntersectionKernel.rayQueue = rayQueue;
				rayIntersectionKernel.hitQueue = hitQueue;
				renderer.compute( rayIntersectionKernel.kernel, rayDispatchConverter.outputDispatch );

				// mark the rays as consumed
				updateRayQueueParamsKernel.rayQueue = rayQueue;
				updateRayQueueParamsKernel.maxCount = RAYS_TO_PROCESS;
				renderer.compute( updateRayQueueParamsKernel.kernel, [ 1, 1, 1 ] );

				// Step 3: convert the queued hit count into an indirect dispatch size
				hitDispatchConverter.queue = hitQueue;
				renderer.compute( hitDispatchConverter.kernel, [ 1, 1, 1 ] );

				// Step 4: next event estimation - deposit the direct-light contribution into
				// hitQueue.resultColor before ProcessHits consumes it
				lightConnectionKernel.hitQueue = hitQueue;
				renderer.compute( lightConnectionKernel.kernel, hitDispatchConverter.outputDispatch );

				// Step 5: attenuate ray color, scatter, run russian roulette over exactly the queued hits
				hitProcessKernel.sampleCountTarget = sampleCountTarget;
				hitProcessKernel.bounces = bounces;
				hitProcessKernel.rayQueue = rayQueue;
				hitProcessKernel.hitQueue = hitQueue;
				renderer.compute( hitProcessKernel.kernel, hitDispatchConverter.outputDispatch );
				// Note: hit queue size ([2] and [3]) is reset at the top of the next iteration by PrimeRayGenerationDispatchKernel

				// Future
				// - track variance to skip rays
				// - switch to rays pushing themselves onto the queue when terminating to avoid tiles once enough pixels have completed
				// - separate "volume" step?
				// - allow for simultaneous writes by queue pixel writes, sorting, and blending them in a single thread

				samples += samplesPerIteration;
				this.samples = Math.floor( samples );

			}

			yield;

		}

	}

}
