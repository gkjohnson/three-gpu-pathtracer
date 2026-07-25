import { Matrix4, IndirectStorageBufferAttribute, Vector2 } from 'three/webgpu';
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
import { queuedHitStruct, queuedRayStruct } from './compute/wavefront/structs.js';
import { PathTracerBackend } from './PathTracerBackend.js';

// set the buffers to the max possible size supported by default (128MB)
// TODO: this can be increased based on platform.
const RAYS_TO_PROCESS = 250000;
const MAX_BUFFER_SIZE = 134217728;
const MAX_RAY_COUNT = Math.floor( MAX_BUFFER_SIZE / ( queuedRayStruct.getLength() * 4 ) );
const MAX_HIT_COUNT = Math.floor( MAX_BUFFER_SIZE / ( queuedHitStruct.getLength() * 4 ) );

export class WaveFrontPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.tiles = new Vector2( 3, 3 );
		this.envInfo = new EquirectHdrInfoNode();
		this.backgroundInfo = new EquirectBackgroundInfo();
		this.lightsInfo = new LightsInfoNode();

		// queues
		this.rayQueue = new IndirectStorageBufferAttribute( MAX_RAY_COUNT, queuedRayStruct.getLength() );
		this.rayQueue.name = 'Ray Queue';

		this.hitQueue = new IndirectStorageBufferAttribute( MAX_HIT_COUNT, queuedHitStruct.getLength() );
		this.hitQueue.name = 'Hit Queue';

		// [0] ray head, [1] ray count, [2] hit head, [3] hit count
		this.queueSizes = new IndirectStorageBufferAttribute( 4, 1 );
		this.queueSizes.name = 'Queue Sizes';

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
		this.enqueueRaysKernel.needsUpdate = true;

		this.rayIntersectionKernel.bvhData = bvhData;
		this.rayIntersectionKernel.needsUpdate = true;

		this.hitProcessKernel.bvhData = bvhData;
		this.hitProcessKernel.needsUpdate = true;

		this.lightConnectionKernel.bvhData = bvhData;
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

	setEnvironment( envMap ) {

		this.envInfo.updateFrom( envMap );

	}

	setLights( lights, iesTextures ) {

		this.lightsInfo.updateFrom( lights, iesTextures );
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
			queueSizes,
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

		// clear queues
		// TODO: why do we need to se the work group size here?
		zeroDispatchKernel.target = queueSizes;
		renderer.compute( zeroDispatchKernel.kernel, [ queueSizes.count ] );

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
			queueSizes,
			rayGenerationDispatch,
			// hitProcessDispatch,
			tileIndexBuffer,

			primeRayGenerationDispatchKernel,
			enqueueRaysKernel,
			rayIntersectionKernel,
			updateRayQueueParamsKernel,
			hitProcessKernel,
			lightConnectionKernel,

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
				primeRayGenerationDispatchKernel.queueSizes = queueSizes;
				primeRayGenerationDispatchKernel.outputTileIndex = tileIndexBuffer;
				primeRayGenerationDispatchKernel.outputDispatch = rayGenerationDispatch;

				// set up the ray generation kernel
				enqueueRaysKernel.tileIndexBuffer = tileIndexBuffer;
				enqueueRaysKernel.tileSize.copy( tileSize );
				enqueueRaysKernel.rayQueue = rayQueue;
				enqueueRaysKernel.queueSizes = queueSizes;
				enqueueRaysKernel.sampleCountTarget = sampleCountTarget;

				for ( let i = 0; i < tiles.x * tiles.y; i ++ ) {

					// TODO: skip rays that have converged, have reach max samples
					renderer.compute( primeRayGenerationDispatchKernel.kernel, [ 1, 1, 1 ] );
					renderer.compute( enqueueRaysKernel.kernel, rayGenerationDispatch );
					primeRayGenerationDispatchKernel.tileOffset = 1;

				}

				// Step 2: run intersections, add color for terminated rays, add material handling to a dedicated queue
				// TODO: setting dispatch size to 10000 is causing failures / missed rays
				const intersectDispatch = rayIntersectionKernel.getDispatchSize( RAYS_TO_PROCESS, 1, 1 );
				rayIntersectionKernel.sampleCountTarget = sampleCountTarget;
				rayIntersectionKernel.rayQueue = rayQueue;
				rayIntersectionKernel.queueSizes = queueSizes;
				rayIntersectionKernel.hitQueue = hitQueue;
				renderer.compute( rayIntersectionKernel.kernel, intersectDispatch );

				// mark the rays as consumed
				const processed = intersectDispatch[ 0 ] * rayIntersectionKernel.workgroupSize[ 0 ];
				updateRayQueueParamsKernel.processed = processed;
				updateRayQueueParamsKernel.queueSizes = queueSizes;
				renderer.compute( updateRayQueueParamsKernel.kernel, [ 1, 1, 1 ] );

				// Step 3: next event estimation - deposit the direct-light contribution into
				// hitQueue.resultColor before ProcessHits consumes it
				lightConnectionKernel.queueSizes = queueSizes;
				lightConnectionKernel.hitQueue = hitQueue;
				renderer.compute( lightConnectionKernel.kernel, lightConnectionKernel.getDispatchSize( processed, 1, 1 ) );

				// TODO: we should use an indirect dispatch here to only kick off the number of threads
				// as needed to iterate over all the fields
				// Step 4: attenuate ray color, scatter, run russian roulette
				hitProcessKernel.sampleCountTarget = sampleCountTarget;
				hitProcessKernel.bounces = bounces;
				hitProcessKernel.rayQueue = rayQueue;
				hitProcessKernel.queueSizes = queueSizes;
				hitProcessKernel.hitQueue = hitQueue;
				renderer.compute( hitProcessKernel.kernel, hitProcessKernel.getDispatchSize( processed, 1, 1 ) );
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
