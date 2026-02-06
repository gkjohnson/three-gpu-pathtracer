import { StorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement, IndirectStorageBufferAttribute } from 'three/webgpu';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { PrimeRayGenerationDispatchKernel } from './compute/wavefront/PrimeRayGenerationDispatchKernel.js';
import { RayGenerationKernel } from './compute/wavefront/RayGenerationKernel.js';
import { RayIntersectionKernel } from './compute/wavefront/RayIntersectionKernel.js';
import { UpdateRayQueueParamsKernel } from './compute/wavefront/UpdateRayQueueParamsKernel.js';

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
		const intersectDispatch = rayIntersectionKernel.getDispatchSize( 50000, 1, 1 );
		rayIntersectionKernel.outputTarget = outputTarget;
		rayIntersectionKernel.sampleCountTarget = sampleCountTarget;

		rayIntersectionKernel.rayQueue = rayQueue;
		rayIntersectionKernel.rayQueueSize = rayQueueSize;
		rayIntersectionKernel.hitQueue = hitQueue;
		rayIntersectionKernel.hitQueueSize = hitQueueSize;
		rayIntersectionKernel.geom_index = geometry.index;
		rayIntersectionKernel.geom_position = geometry.position;
		rayIntersectionKernel.geom_normals = geometry.normal;
		rayIntersectionKernel.geom_material_index = geometry.materialIndex;
		rayIntersectionKernel.bvh = geometry.bvh;
		rayIntersectionKernel.materials = geometry.materials;
		renderer.compute( rayIntersectionKernel.kernel, intersectDispatch );

		// mark the rays as consumed
		updateRayQueueParamsKernel.processed = intersectDispatch[ 0 ] * rayIntersectionKernel.workGroupSize[ 0 ];
		updateRayQueueParamsKernel.rayQueueSize = rayQueueSize;
		renderer.compute( updateRayQueueParamsKernel.kernel, [ 1, 1, 1 ] );

		// Step 3: attenuate ray color, scatter, run russian roulette
		// TODO

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
		this.rayQueue = new StorageBufferAttribute( new Uint32Array( queueSize ) );
		this.rayQueue.name = 'Ray Queue';
		this.rayQueueSize = new StorageBufferAttribute( new Uint32Array( 2 ) );
		this.rayQueueSize.name = 'Ray Queue Size';

		this.hitQueue = new StorageBufferAttribute( new Uint32Array( queueSize ) );
		this.hitQueue.name = 'Hit Queue';
		this.hitQueueSize = new StorageBufferAttribute( new Uint32Array( 2 ) );
		this.hitQueueSize.name = 'Hit Queue Size';

		// dispatches
		this.tileIndexBuffer = new StorageBufferAttribute( new Uint32Array( 2 ) );
		this.rayGenerationDispatch = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.hitProcessDispatch = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );

		// kernels
		this.primeRayGenerationDispatchKernel = new PrimeRayGenerationDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.enqueueRaysKernel = new RayGenerationKernel().setWorkgroupSize( 8, 8, 1 );
		this.rayIntersectionKernel = new RayIntersectionKernel().setWorkgroupSize( 64, 1, 1 );
		this.updateRayQueueParamsKernel = new UpdateRayQueueParamsKernel().setWorkgroupSize( 1, 1, 1 );
		this.hitProcessKernel = null;

		// clear kernels
		this.sampleCountClearKernel = new ZeroOutKernel( { textureType: 'r32uint' } ).setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );

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
			sampleCountTarget,
			outputTarget,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		this._task = null;

		const { width, height } = sampleCountTarget;
		const dispatchSize = sampleCountClearKernel.getDispatchSize( width, height );

		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

	}

	update() {

		if ( ! this.camera ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
