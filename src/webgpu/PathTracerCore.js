import {
	IndirectStorageBufferAttribute,
	StorageBufferAttribute,
	Vector2,
	TimestampQuery,
	StorageTexture,
	RGBAFormat,
	RedIntegerFormat,
	FloatType,
	UnsignedIntType,
	LinearFilter,
	ColorManagement,
} from 'three/webgpu';
import { MaterialStageDispatchKernel, TraceRayDispatchKernel } from './compute/wavefront2/DispatchKernels.js';
import { RegenerateRaysKernel } from './compute/wavefront2/RegenerateRaysKernel.js';
import { RayIntersectionKernel } from './compute/wavefront2/RayIntersectionKernel.js';
import { LogicKernel } from './compute/wavefront2/LogicKernel.js';
import { EvaluateMaterialKernel } from './compute/wavefront2/EvaluateMaterialKernel.js';
import { ResetKernel } from './compute/wavefront2/ResetKernel.js';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';

function* renderTask() {

	const tileSize = new Vector2();

	while ( true ) {

		const {
			_renderer,
			logicKernel,
			materialStageDispatchKernel,
			regenerateRaysKernel,
			materialEvalKernel,
			traceRayDispatchKernel,
			traceRayKernel,

			regenerateDispatchBuffer,
			materialDispatchBuffer,
			traceRayDispatchBuffer,
		} = this;

		this.getTileSize( tileSize );

		_renderer.info.reset();

		// const dispatchSize = [
		// 	Math.ceil( tileSize.x / WORKGROUP_SIZE[ 0 ] ),
		// 	Math.ceil( tileSize.y / WORKGROUP_SIZE[ 1 ] ),
		// 	1,
		// ];

		// 0. Clean queues on camera change?
		// 0.1 Generate one ray per pixel and write it into ray queue
		// _renderer.compute( this.generateRaysKernel, dispatchSize );

		// Current tile characteristics
		const currentTileVec = new Vector2(
			this.currentTile % this.tiles.x,
			Math.floor( this.currentTile / this.tiles.x )
		);
		const offset = currentTileVec.multiply( tileSize );

		// Setup all the state for kernels
		logicKernel.tileOffset.copy( offset );
		logicKernel.tileSize.copy( tileSize );
		this.getSize( logicKernel.dimensions );
		logicKernel.maxBounces = this.bounces;

		logicKernel.outputTarget = this.outputTarget;
		logicKernel.sampleCountTarget = this.sampleCountTarget;
		logicKernel.pathState = this.pathState;
		logicKernel.regeneratePathQueue = this.regeneratePathQueue;
		logicKernel.materialEvalQueue = this.materialEvalQueue;
		logicKernel.queueSizes = this.queueSizes;
		logicKernel.geomMaterialIndex = this.geometry.materialIndex;

		materialStageDispatchKernel.regenerateDispatchBuffer = regenerateDispatchBuffer;
		materialStageDispatchKernel.regenerateKernelWorkgroupSize = regenerateRaysKernel.workgroupSize[ 0 ];
		materialStageDispatchKernel.materialDispatchBuffer = materialDispatchBuffer;
		materialStageDispatchKernel.materialKernelWorkgroupSize = materialEvalKernel.workgroupSize[ 0 ];
		materialStageDispatchKernel.queueSizes = this.queueSizes;

		regenerateRaysKernel.seed += 1;
		regenerateRaysKernel.cameraToModelMatrix.copy( this.camera.matrixWorld );
		regenerateRaysKernel.inverseProjectionMatrix.copy( this.camera.projectionMatrixInverse );
		regenerateRaysKernel.tileOffset.copy( offset );
		regenerateRaysKernel.tileSize.copy( tileSize );
		this.getSize( regenerateRaysKernel.dimensions );

		regenerateRaysKernel.pathState = this.pathState;
		regenerateRaysKernel.inputQueue = this.regeneratePathQueue;
		regenerateRaysKernel.extensionRayQueue = this.extensionRayQueue;
		regenerateRaysKernel.queueSizes = this.queueSizes;

		materialEvalKernel.pathState = this.pathState;
		materialEvalKernel.inputQueue = this.materialEvalQueue;
		materialEvalKernel.extensionRayQueue = this.extensionRayQueue;
		materialEvalKernel.queueSizes = this.queueSizes;
		materialEvalKernel.geomNormals = this.geometry.normal;
		materialEvalKernel.materials = this.geometry.materials;

		traceRayDispatchKernel.traceRayDispatchBuffer = traceRayDispatchBuffer;
		traceRayDispatchKernel.traceRayKernelWorkgroupSize = traceRayKernel.workgroupSize[ 0 ];
		traceRayDispatchKernel.queueSizes = this.queueSizes;

		traceRayKernel.pathState = this.pathState;
		traceRayKernel.inputQueue = this.extensionRayQueue;
		traceRayKernel.queueSizes = this.queueSizes;
		traceRayKernel.geomIndex = this.geometry.index;
		traceRayKernel.geomPosition = this.geometry.position;
		traceRayKernel.bvh = this.geometry.bvh;

		// Run n waves
		const logicDispatchSize = logicKernel.getDispatchSize( tileSize.x * tileSize.y, 1, 1 );

		for ( let i = 0; i < 5; i ++ ) {

			// 1. Logic stage
			// Process material eval and ray intersection results
			// Enqueue material evaluations and paths to regenerate
			_renderer.compute( logicKernel.kernel, logicDispatchSize );

			// 2. Material stage:
			// Evaluate hits, regenerate misses
			// Enqueue extension rays to trace
			_renderer.compute( materialStageDispatchKernel.kernel, 1 );
			_renderer.compute( regenerateRaysKernel.kernel, regenerateDispatchBuffer );
			_renderer.compute( materialEvalKernel.kernel, materialDispatchBuffer );

			// 3. Extension rays tracing stage
			_renderer.compute( traceRayDispatchKernel.kernel, 1 );
			_renderer.compute( traceRayKernel.kernel, traceRayDispatchBuffer );

		}


		this.samples += 1;

		const updateTimestamps = async () => {

			await _renderer.resolveTimestampsAsync( TimestampQuery.COMPUTE );
			const delta = _renderer.info.compute.timestamp;

			return delta;

		};

		this.getLatestSampleTimestamp = updateTimestamps;


		yield;

	}

}

export class PathTracerCore {

	constructor( renderer ) {

		this.camera = null;
		this._renderer = renderer;
		this._task = null;

		this.samples = 0;
		this.bounces = 7;

		this.tiles = new Vector2( 2, 2 );
		this.tileSize = new Vector2();
		this.currentTile = 0;

		this.dimensions = new Vector2();

		this.getLatestSampleTimestamp = async () => {

			return 0;

		};

		this.geometry = {
			bvh: new StorageBufferAttribute(),
			index: new StorageBufferAttribute(),
			position: new StorageBufferAttribute(),
			normal: new StorageBufferAttribute(),

			materialIndex: new StorageBufferAttribute(),
			materials: new StorageBufferAttribute(),
		};

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

		// this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 ) );
		// this.resultBuffer.name = 'Result Image #0';

		// this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( 1 ) );
		// this.sampleCountBuffer.name = 'Sample Count';

		// More resolution does not fit into webgpu-defualt 128mb buffer
		const pathStateStructSize = 176;
		this.maxRayCount = 128 * 1024 * 1024 / pathStateStructSize;
		this.maxRayCount -= this.maxRayCount % 128; // Make maxRayCount a multiple of 128
		const pathStateSize = ( pathStateStructSize / 4 ) * this.maxRayCount;
		this.pathState = new StorageBufferAttribute( new Uint32Array( pathStateSize ) );
		this.pathState.name = 'Path State';
		//
		// [regeneratePathQueue size; materialEvalQueue size; extensionRayQueue size]
		this.queueSizes = new StorageBufferAttribute( new Uint32Array( 3 ) );
		this.queueSizes.name = 'Queue Sizes';

		this.regeneratePathQueue = new StorageBufferAttribute( new Uint32Array( this.maxRayCount ) );
		this.regeneratePathQueue.name = 'Regenerate Path Queue';

		this.materialEvalQueue = new StorageBufferAttribute( new Uint32Array( this.maxRayCount ) );
		this.materialEvalQueue.name = 'Material Eval Queue';

		this.extensionRayQueue = new StorageBufferAttribute( new Uint32Array( this.maxRayCount ) );
		this.extensionRayQueue.name = 'Extension Ray Queue';

		this.resetKernelWorkgroupSize = [ 8, 8, 1 ];
		this.materialWorkgroupSize = [ 128, 1, 1 ];
		this.traceRayWorkgroupSize = [ 128, 1, 1 ];
		this.logicKernelWorkgroupSize = [ 128, 1, 1 ];
		this.regenerateRayWorkgroupSize = [ 128, 1, 1 ];

		this.resetKernel = new ResetKernel().setWorkgroupSize( ...this.resetKernelWorkgroupSize );
		this.regenerateRaysKernel = new RegenerateRaysKernel().setWorkgroupSize( ...this.regenerateRayWorkgroupSize );
		this.traceRayKernel = new RayIntersectionKernel().setWorkgroupSize( ...this.traceRayWorkgroupSize );
		this.logicKernel = new LogicKernel().setWorkgroupSize( ...this.logicKernelWorkgroupSize );
		this.materialEvalKernel = new EvaluateMaterialKernel().setWorkgroupSize( ...this.materialWorkgroupSize );

		this.traceRayDispatchKernel = new TraceRayDispatchKernel().setWorkgroupSize( 1, 1, 1 );
		this.materialStageDispatchKernel = new MaterialStageDispatchKernel().setWorkgroupSize( 1, 1, 1 );

		this.sampleCountClearKernel = new ZeroOutKernel( { textureType: 'r32uint' } ).setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );

		this.traceRayDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.traceRayDispatchBuffer.name = 'Dispatch Buffer for Trace Ray';

		this.regenerateDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.regenerateDispatchBuffer.name = 'Dispatch Buffer for Regenerate Rays Kernel';

		this.materialDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.materialDispatchBuffer.name = 'Dispatch Buffer for Material Eval Kernel';


	}

	setGeometryData( geometry ) {

		for ( const propName in geometry ) {

			const prop = this.geometry[ propName ];
			if ( prop === undefined ) {

				console.error( `Invalid property name in geometry data: ${propName}` );
				continue;

			}

			try {

				this._renderer.destroyAttribute( prop );

			} catch ( e ) {

				console.error( 'Failed to destroy geometry attribute. Pbbly because it did not have a gpu buffer' );

			}

			this.geometry[ propName ] = geometry[ propName ];

		}

	}

	setCamera( camera ) {

		this.camera = camera;

	}

	setSize( w, h ) {

		// Automatically adjust tileSize to fit into maxRayCount
		const pixelPerTile = ( w * h ) / ( this.tiles.x * this.tiles.y );
		if ( pixelPerTile > this.maxRayCount ) {

			const minTileCount = Math.ceil( ( w * h ) / this.maxRayCount );
			const tilesPerSide = Math.ceil( Math.sqrt( minTileCount ) );
			this.setTiles( new Vector2( tilesPerSide, tilesPerSide ) );

		}

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

		return target.set( this.outputTarget.width, this.outputTarget.height );

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
			_renderer,

			sampleCountClearKernel,
			outputTargetClearKernel,

			sampleCountTarget,
			outputTarget,
		} = this;

		if ( ! _renderer.initialized ) {

			return;

		}

		this._task = null;

		const { width, height } = sampleCountTarget;
		const dispatchSize = sampleCountClearKernel.getDispatchSize( width, height );

		// clear targets
		sampleCountClearKernel.setWorkgroupSize( 8, 8, 1 );
		sampleCountClearKernel.target = sampleCountTarget;
		_renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.setWorkgroupSize( 8, 8, 1 );
		outputTargetClearKernel.target = outputTarget;
		_renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		this.regenerateRaysKernel.seed = 0;

		this.samples = 0;
		this.currentTile = 0;
		this._task = null;

	}

	update() {

		if ( ! this.camera ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

		this.currentTile = ( this.currentTile + 1 ) % ( this.tiles.x * this.tiles.y );

	}

	getResultBuffer() {

		return this.resultBuffer;

	}

}
