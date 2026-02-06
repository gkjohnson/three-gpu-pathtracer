import { StorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement, IndirectStorageBufferAttribute } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { PrimeRayGenerationDispatchKernel } from './compute/wavefront/PrimeRayGenerationDispatchKernel.js';
import { RayGenerationKernel } from './compute/wavefront/RayGenerationKernel.js';
import { RayIntersectionKernel } from './compute/wavefront/RayIntersectionKernel.js';
import { UpdateRayQueueParamsKernel } from './compute/wavefront/UpdateRayQueueParamsKernel.js';
import { ZeroOutBufferKernel } from './compute/ZeroOutBufferKernel.js';
import { ProcessHitsKernel } from './compute/wavefront/ProcessHitsKernel.js';

const RAYS_TO_PROCESS = 250000;

function* renderTask() {

	const {
		renderer,
		camera,
		geometry,
		bounces,

		tiles,
		outputTarget,
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

	const tileSize = new Vector2();
	while ( true ) {

		this.getTileSize( tileSize );

		// Step 1: Top up the ray queue
		// set up the ray prime kernel
		primeRayGenerationDispatchKernel.setWorkgroupSize( 1, 1, 1 );
		primeRayGenerationDispatchKernel.rayWorkGroupSize.set( 8, 8, 1 );
		primeRayGenerationDispatchKernel.tileCount.copy( tiles );
		primeRayGenerationDispatchKernel.tileSize.copy( tileSize );
		primeRayGenerationDispatchKernel.rayQueue = rayQueue;
		primeRayGenerationDispatchKernel.rayQueueSize = rayQueueSize;
		primeRayGenerationDispatchKernel.outputTileIndex = tileIndexBuffer;
		primeRayGenerationDispatchKernel.outputDispatch = rayGenerationDispatch;

		// set up the ray generation kernel
		enqueueRaysKernel.setWorkgroupSize( 8, 8, 1 );
		enqueueRaysKernel.seed ++;
		enqueueRaysKernel.cameraToModelMatrix.copy( camera.matrixWorld );
		enqueueRaysKernel.inverseProjectionMatrix.copy( camera.projectionMatrixInverse );
		enqueueRaysKernel.tileIndexBuffer = tileIndexBuffer;
		enqueueRaysKernel.tileSize.copy( tileSize );
		enqueueRaysKernel.rayQueue = rayQueue;
		enqueueRaysKernel.rayQueueSize = rayQueueSize;
		enqueueRaysKernel.sampleCountTarget = sampleCountTarget;
		enqueueRaysKernel.outputTarget = outputTarget;

		for ( let i = 0; i < tiles.x * tiles.y; i ++ ) {

			// TODO: skip rays that have converged, have reach max samples
			renderer.compute( primeRayGenerationDispatchKernel.kernel, [ 1, 1, 1 ] );
			renderer.compute( enqueueRaysKernel.kernel, rayGenerationDispatch );

		}

		// Step 2: run intersections, add color for terminated rays, add material handling to a dedicated queue
		// TODO: setting dispatch size to 10000 is causing failures / missed rays
		rayIntersectionKernel.setWorkgroupSize( 64, 1, 1 );
		const intersectDispatch = rayIntersectionKernel.getDispatchSize( RAYS_TO_PROCESS, 1, 1 );
		rayIntersectionKernel.outputTarget = outputTarget;
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
		updateRayQueueParamsKernel.setWorkgroupSize( 1, 1, 1 );
		updateRayQueueParamsKernel.processed = processed;
		updateRayQueueParamsKernel.rayQueueSize = rayQueueSize;
		renderer.compute( updateRayQueueParamsKernel.kernel, [ 1, 1, 1 ] );

		// TODO: we should use an indirect dispatch here to only kick off the number of threads
		// as needed to iterate over all the fields
		// Step 3: attenuate ray color, scatter, run russian roulette
		hitProcessKernel.setWorkgroupSize( 64, 1, 1 );
		hitProcessKernel.outputTarget = outputTarget;
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
		zeroDispatchKernel.setWorkgroupSize( 1, 1, 1 );
		zeroDispatchKernel.target = hitQueueSize;
		renderer.compute( zeroDispatchKernel.kernel, [ hitQueueSize.count, 1, 1 ] );

		// Step 4: connect to lights
		// TODO

		// Future
		// - track variance to skip rays
		// - switch to rays pushing themselves onto the queue when terminating to avoid tiles once enough pixels have completed
		// - separate "volume" step?
		// - allow for simultaneous writes by queue pixel writes, sorting, and blending them in a single thread

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
		this.tiles = new Vector2( 2, 2 );

		// geometry fields
		this.geometry = {
			bvh: new StorageBufferAttribute(),
			index: new StorageBufferAttribute(),
			position: new StorageBufferAttribute(),
			normal: new StorageBufferAttribute(),

			materialIndex: new StorageBufferAttribute(),
			materials: new StorageBufferAttribute(),
		};

		// targets
		this.outputTarget = new StorageTexture( 1, 1, );
		this.outputTarget.format = RGBAFormat;
		this.outputTarget.type = FloatType;
		this.outputTarget.magFilter = LinearFilter;
		this.outputTarget.colorSpace = ColorManagement.workingColorSpace;
		this.outputTarget.name = 'Output';
		this.outputTarget.generateMipmaps = false;

		this.sampleCountTarget = new StorageTexture( 1, 1, );
		this.sampleCountTarget.format = RedIntegerFormat;
		this.sampleCountTarget.type = UnsignedIntType;
		this.sampleCountTarget.name = 'Sample Count';
		this.sampleCountTarget.generateMipmaps = false;

		// queue
		const maxRayCount = 1000 * 1000;
		const queueSize = 16 * maxRayCount;
		this.rayQueue = new StorageBufferAttribute( new Uint32Array( queueSize ), 16 );
		this.rayQueue.name = 'Ray Queue';
		this.rayQueueSize = new StorageBufferAttribute( new Uint32Array( 2 ), 1 );
		this.rayQueueSize.name = 'Ray Queue Size';

		this.hitQueue = new StorageBufferAttribute( new Uint32Array( queueSize ), 16 );
		this.hitQueue.name = 'Hit Queue';
		this.hitQueueSize = new StorageBufferAttribute( new Uint32Array( 2 ), 1 );
		this.hitQueueSize.name = 'Hit Queue Size';

		// dispatches
		this.tileIndexBuffer = new StorageBufferAttribute( new Uint32Array( 2 ), 1 );
		this.rayGenerationDispatch = new IndirectStorageBufferAttribute( new Uint32Array( 3 ), 1 );
		this.hitProcessDispatch = new IndirectStorageBufferAttribute( new Uint32Array( 3 ), 1 );

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

	setGeometryData( geometry ) {

		for ( const propName in geometry ) {

			const prop = this.geometry[ propName ];
			if ( prop === undefined ) {

				console.error( `Invalid property name in geometry data: ${propName}` );
				continue;

			}

			// TODO: cannot dispose at the moment
			// prop.dispose();
			this.geometry[ propName ] = geometry[ propName ];

		}

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
		this.sampleCountTarget.dispose();

		this.outputTarget = this.outputTarget.clone();
		this.sampleCountTarget = this.sampleCountTarget.clone();

		this.outputTarget.setSize( w, h );
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

		const { width, height } = sampleCountTarget;
		const dispatchSize = sampleCountClearKernel.getDispatchSize( width, height );

		// clear buffers
		sampleCountClearKernel.setWorkgroupSize( 8, 8, 1 );
		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.setWorkgroupSize( 8, 8, 1 );
		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		// clear queues
		// TODO: why do we need to se the work group size here?
		zeroDispatchKernel.setWorkgroupSize( 1, 1, 1 );
		zeroDispatchKernel.target = rayQueueSize;
		renderer.compute( zeroDispatchKernel.kernel, [ rayQueueSize.count ] );

		zeroDispatchKernel.setWorkgroupSize( 1, 1, 1 );
		zeroDispatchKernel.target = hitQueueSize;
		renderer.compute( zeroDispatchKernel.kernel, [ hitQueueSize.count ] );

		// clear dispatch sizes
		zeroDispatchKernel.setWorkgroupSize( 1, 1, 1 );
		zeroDispatchKernel.target = hitProcessDispatch;
		renderer.compute( zeroDispatchKernel.kernel, [ hitProcessDispatch.count ] );

		zeroDispatchKernel.setWorkgroupSize( 1, 1, 1 );
		zeroDispatchKernel.target = rayGenerationDispatch;
		renderer.compute( zeroDispatchKernel.kernel, [ rayGenerationDispatch.count ] );

		zeroDispatchKernel.setWorkgroupSize( 1, 1, 1 );
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
