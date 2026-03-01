import { Matrix4, IndirectStorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { PrimeRayGenerationDispatchKernel } from './compute/wavefront/PrimeRayGenerationDispatchKernel.js';
import { RayGenerationKernel } from './compute/wavefront/RayGenerationKernel.js';
import { RayIntersectionKernel } from './compute/wavefront/RayIntersectionKernel.js';
import { UpdateRayQueueParamsKernel } from './compute/wavefront/UpdateRayQueueParamsKernel.js';
import { ZeroOutBufferKernel } from './compute/ZeroOutBufferKernel.js';
import { ProcessHitsKernel } from './compute/wavefront/ProcessHitsKernel.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { queuedHitStruct, queuedRayStruct } from './compute/wavefront/structs.js';

// set the buffers to the max possible size supported by default (128MB)
// TODO: this can be increased based on platform.
const RAYS_TO_PROCESS = 250000;
const MAX_BUFFER_SIZE = 134217728;
const MAX_RAY_COUNT = Math.floor( MAX_BUFFER_SIZE / ( queuedRayStruct.getLength() * 4 ) );
const MAX_HIT_COUNT = Math.floor( MAX_BUFFER_SIZE / ( queuedHitStruct.getLength() * 4 ) );

function* renderTask() {

	const {
		renderer,
		camera,
		geometry,
		bounces,

		tiles,
		sampleCountTarget,

		rayQueue,
		rayQueueSize,
		rayGenerationDispatch,

		hitQueue,
		hitQueueSize,
		hitProcessDispatch,
		tileIndexBuffer,

		primeRayGenerationDispatchKernel,
		enqueueRaysKernel,
		rayIntersectionKernel,
		updateRayQueueParamsKernel,
		hitProcessKernel,
		zeroDispatchKernel,
	} = this;

	camera.updateMatrixWorld();

	primeRayGenerationDispatchKernel.tileOffset = 0;

	const tileSize = new Vector2();
	const samplesPerIteration = RAYS_TO_PROCESS / ( sampleCountTarget.width * sampleCountTarget.height * bounces );
	let samples = 0;
	while ( true ) {

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
		primeRayGenerationDispatchKernel.rayQueueSize = rayQueueSize;
		primeRayGenerationDispatchKernel.outputTileIndex = tileIndexBuffer;
		primeRayGenerationDispatchKernel.outputDispatch = rayGenerationDispatch;

		// set up the ray generation kernel
		enqueueRaysKernel.seed ++;
		enqueueRaysKernel.cameraToModelMatrix.copy( camera.matrixWorld );
		enqueueRaysKernel.inverseProjectionMatrix.copy( camera.projectionMatrixInverse );
		enqueueRaysKernel.tileIndexBuffer = tileIndexBuffer;
		enqueueRaysKernel.tileSize.copy( tileSize );
		enqueueRaysKernel.rayQueue = rayQueue;
		enqueueRaysKernel.rayQueueSize = rayQueueSize;
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
		rayIntersectionKernel.rayQueueSize = rayQueueSize;
		rayIntersectionKernel.hitQueue = hitQueue;
		rayIntersectionKernel.hitQueueSize = hitQueueSize;
		rayIntersectionKernel.geom_index = geometry.index;
		rayIntersectionKernel.geom_position = geometry.position;
		rayIntersectionKernel.geom_material_index = geometry.materialIndex;
		rayIntersectionKernel.bvh = geometry.bvh;
		renderer.compute( rayIntersectionKernel.kernel, intersectDispatch );

		// mark the rays as consumed
		const processed = intersectDispatch[ 0 ] * rayIntersectionKernel.workgroupSize[ 0 ];
		updateRayQueueParamsKernel.processed = processed;
		updateRayQueueParamsKernel.rayQueueSize = rayQueueSize;
		renderer.compute( updateRayQueueParamsKernel.kernel, [ 1, 1, 1 ] );

		// TODO: we should use an indirect dispatch here to only kick off the number of threads
		// as needed to iterate over all the fields
		// Step 3: attenuate ray color, scatter, run russian roulette
		hitProcessKernel.sampleCountTarget = sampleCountTarget;
		hitProcessKernel.bounces = bounces;
		hitProcessKernel.rayQueue = rayQueue;
		hitProcessKernel.rayQueueSize = rayQueueSize;
		hitProcessKernel.hitQueue = hitQueue;
		hitProcessKernel.hitQueueSize = hitQueueSize;
		hitProcessKernel.geom_position = geometry.position;
		hitProcessKernel.geom_normals = geometry.normal;
		hitProcessKernel.materials = geometry.materials;
		renderer.compute( hitProcessKernel.kernel, hitProcessKernel.getDispatchSize( processed, 1, 1 ) );

		// TODO: for some reason we need to call "setWorkgroupSize" here? Is it because work group size
		// is cached per parameters and resets?
		zeroDispatchKernel.target = hitQueueSize;
		renderer.compute( zeroDispatchKernel.kernel, [ hitQueueSize.count, 1, 1 ] );

		// Step 4: connect to lights
		// TODO

		// Future
		// - track variance to skip rays
		// - switch to rays pushing themselves onto the queue when terminating to avoid tiles once enough pixels have completed
		// - separate "volume" step?
		// - allow for simultaneous writes by queue pixel writes, sorting, and blending them in a single thread

		samples += samplesPerIteration;
		this.samples = Math.floor( samples );

		yield;

	}

}

export class WaveFrontPathTracer {

	constructor( renderer ) {

		this.camera = null;
		this.renderer = renderer;
		this._task = null;

		// options
		this.samples = 0;
		this.bounces = 7;
		this.tiles = new Vector2( 3, 3 );
		this.lowResMode = false;

		// geometry fields
		this.geometry = {
			bvh: null,
			index: null,
			position: null,
			normal: null,

			materialIndex: null,
			materials: null,
		};

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

		// queues
		this.rayQueue = new IndirectStorageBufferAttribute( MAX_RAY_COUNT, 16 );
		this.rayQueue.name = 'Ray Queue';
		this.rayQueueSize = new IndirectStorageBufferAttribute( 2, 1 );
		this.rayQueueSize.name = 'Ray Queue Size';

		this.hitQueue = new IndirectStorageBufferAttribute( MAX_HIT_COUNT, 16 );
		this.hitQueue.name = 'Hit Queue';
		this.hitQueueSize = new IndirectStorageBufferAttribute( 2, 1 );
		this.hitQueueSize.name = 'Hit Queue Size';

		// dispatches
		this.tileIndexBuffer = new IndirectStorageBufferAttribute( 2, 1 );
		this.rayGenerationDispatch = new IndirectStorageBufferAttribute( 3, 1 );
		this.hitProcessDispatch = new IndirectStorageBufferAttribute( 3, 1 );

		// kernels
		this.primeRayGenerationDispatchKernel = new PrimeRayGenerationDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.enqueueRaysKernel = new RayGenerationKernel().setWorkgroupSize( 8, 8, 1 );
		this.rayIntersectionKernel = new RayIntersectionKernel().setWorkgroupSize( 64, 1, 1 );
		this.updateRayQueueParamsKernel = new UpdateRayQueueParamsKernel().setWorkgroupSize( 1, 1, 1 );
		this.hitProcessKernel = new ProcessHitsKernel().setWorkgroupSize( 64, 1, 1 );

		// clear kernels
		this.sampleCountClearKernel = new ZeroOutKernel( { textureType: 'r32uint' } ).setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );
		this.zeroDispatchKernel = new ZeroOutBufferKernel().setWorkgroupSize( 1, 1, 1 );

		// later
		this.volumeKernel = null;
		this.lightConnectionKernel = null;

	}

	setBVHData( bvhData ) {

		this.rayIntersectionKernel.bvhData = bvhData;
		this.rayIntersectionKernel.needsUpdate = true;

		this.hitProcessKernel.bvhData = bvhData;
		this.hitProcessKernel.needsUpdate = true;

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

		const kernel = this.rayIntersectionKernel;

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
			zeroDispatchKernel,

			sampleCountTarget,
			outputTarget,
			prevOutputTarget,

			hitProcessDispatch,
			rayGenerationDispatch,
			rayQueueSize,
			hitQueueSize,
			tileIndexBuffer,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		this._task = null;
		this.samples = 0;

		const { width, height } = sampleCountTarget;
		const dispatchSize = sampleCountClearKernel.getDispatchSize( width, height );

		// clear buffers
		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = prevOutputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		// clear queues
		// TODO: why do we need to se the work group size here?
		zeroDispatchKernel.target = rayQueueSize;
		renderer.compute( zeroDispatchKernel.kernel, [ rayQueueSize.count ] );

		zeroDispatchKernel.target = hitQueueSize;
		renderer.compute( zeroDispatchKernel.kernel, [ hitQueueSize.count ] );

		// clear dispatch sizes
		zeroDispatchKernel.target = hitProcessDispatch;
		renderer.compute( zeroDispatchKernel.kernel, [ hitProcessDispatch.count ] );

		zeroDispatchKernel.target = rayGenerationDispatch;
		renderer.compute( zeroDispatchKernel.kernel, [ rayGenerationDispatch.count ] );

		zeroDispatchKernel.target = tileIndexBuffer;
		renderer.compute( zeroDispatchKernel.kernel, [ tileIndexBuffer.count ] );

	}

	update() {

		if ( ! this.camera ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		// TODO: run this multiple times / adjust loop to process more rays at once
		for ( let i = 0; i < 5; i ++ ) {

			this._task.next();

		}

	}

}
