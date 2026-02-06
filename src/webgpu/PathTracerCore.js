import {
	IndirectStorageBufferAttribute,
	StorageBufferAttribute,
	Matrix4,
	Vector2,
	TimestampQuery
} from 'three/webgpu';
import { uniform, storage, globalId, localId } from 'three/tsl';
import megakernelShader from './nodes/megakernel.wgsl.js';
import resetResultFn from './nodes/reset.wgsl.js';
import {
	generateRays, traceRay, bsdfEval, logic, cleanQueues,
	writeTraceRayDispatchSize, writeMaterialStageDispatchSize,
} from './nodes/wavefront.wgsl.js';

function* renderTask() {

	const tileSize = new Vector2();

	while ( true ) {

		const {
			megakernel,
			_renderer,
			WORKGROUP_SIZE,
			useMegakernel,
		} = this;

		this.getTileSize( tileSize );

		_renderer.info.reset();

		if ( useMegakernel ) {

			const dispatchSize = [
				Math.ceil( tileSize.x / WORKGROUP_SIZE[ 0 ] ),
				Math.ceil( tileSize.y / WORKGROUP_SIZE[ 1 ] ),
				1
			];

			_renderer.compute( megakernel, dispatchSize );

		} else {

			const dispatchSize = [
				Math.ceil( tileSize.x / WORKGROUP_SIZE[ 0 ] ),
				Math.ceil( tileSize.y / WORKGROUP_SIZE[ 1 ] ),
				1,
			];

			// 0. Clean queues on camera change?
			// _renderer.compute( this.cleanQueuesKernel, 1 );
			// 0.1 Generate one ray per pixel and write it into ray queue
			// _renderer.compute( this.generateRaysKernel, dispatchSize );

			const logicDispatchSize = [ Math.ceil( tileSize.x * tileSize.y / 128 ), 1, 1 ];

			for ( let i = 0; i < this.bounces; i ++ ) {

				_renderer.compute( this.logicKernel, logicDispatchSize );

				_renderer.compute( this.writeMaterialStageDispatchSizeKernel, 1 );

				_renderer.compute( this.generateRaysKernel, this.regenerateDispatchBuffer );
				_renderer.compute( this.bsdfEvalKernel, this.materialDispatchBuffer );

				_renderer.compute( this.writeTraceRayDispatchSizeKernel, 1 );

				_renderer.compute( this.traceRayKernel, this.traceRayDispatchBuffer );

				// 1. Trace rays from the ray queue
				// Traced ray can either hit something - then it goes into the hitResultQueue
				// If it doesn't hit anything it goes into the escapedRayQueue
				// _renderer.compute( this.writeTraceRayDispatchSizeKernel, 1 );
				// _renderer.compute( this.traceRayKernel, [ ] );

				// 2. Handle escaped and scattered rays
				// 2.1 Calcuate dispatch sizes and write it to gpu buffer
				// _renderer.compute( this.writeEscapedRayDispatchSizeKernel, 1 );
				// _renderer.compute( this.writeBsdfDispatchSizeKernel, 1 );
				// 2.1 Dispatch shaders
				// When processing escaped rays, calculate new contribution and add that to the result image
				// _renderer.compute( this.escapedRayKernel, this.escapedRayDispatchBuffer );
				// When processing hit results, sample a new ray according to material's properties
				// _renderer.compute( this.bsdfEvalKernel, this.bsdfDispatchBuffer );

			}

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

	get megakernelParams() {

		return this.megakernel.computeNode.parameters;

	}

	get traceRayParams() {

		return this.traceRayKernel.computeNode.parameters;

	}

	get bsdfEvalParams() {

		return this.bsdfEvalKernel.computeNode.parameters;

	}

	get logicParams() {

		return this.logicKernel.computeNode.parameters;

	}

	get generateRaysParams() {

		return this.generateRaysKernel.computeNode.parameters;

	}

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

		this.useMegakernel = true;

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

		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 ) );
		this.resultBuffer.name = 'Result Image #0';

		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( 1 ) );
		this.sampleCountBuffer.name = 'Sample Count';

		// More resolution does not fit into webgpu-defualt 128mb buffer
		const pathStateStructSize = 176;
		this.maxRayCount = 128 * 1024 * 1024 / pathStateStructSize;
		this.maxRayCount -= this.maxRayCount % 128; // Make maxRayCount a multiple of 128
		const queueSize = /* element storage */ 16 * this.maxRayCount;
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


		// this.rayQueue = new StorageBufferAttribute( new Uint32Array( 8 * maxRayCount ) );
		// this.rayQueue.name = 'Extension Ray Queue';

		// this.hitResultQueue = new StorageBufferAttribute( new Uint32Array( 16 * maxRayCount ) );
		// this.hitResultQueue.name = 'Hit Result Queue';

		this.WORKGROUP_SIZE = [ 8, 8, 1 ];
		this.bsdfEvalWorkgroupSize = [ 128, 1, 1 ];
		this.traceRayWorkgroupSize = [ 128, 1, 1 ];
		this.escapedRayWorkgroupSize = [ 128, 1, 1 ];
		this.regenerateRayWorkgroupSize = [ 128, 1, 1 ];

		this.createMegakernel();
		this.createResetKernel();

		const generateRaysParams = {

			cameraToModelMatrix: uniform( new Matrix4() ),
			inverseProjectionMatrix: uniform( new Matrix4() ),
			tileOffset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( this.dimensions ),

			pathState: storage( this.pathState, 'PathState' ),
			inputQueue: storage( this.regeneratePathQueue, 'uint' ).toReadOnly(),
			extensionRayQueue: storage( this.extensionRayQueue, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			seed: uniform( 0 ),
			globalId: globalId,
			localId: localId,

		};

		this.generateRaysKernel = generateRays( generateRaysParams ).computeKernel( this.regenerateRayWorkgroupSize );

		this.createTraceRayKernel();
		this.createLogicKernel();
		this.createBsdfEvalKernel();

		this.traceRayDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.traceRayDispatchBuffer.name = 'Dispatch Buffer for Trace Ray';

		const writeTraceRayDispatchSizeParams = {
			outputBuffer: storage( this.traceRayDispatchBuffer, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			workgroupSize: uniform( this.traceRayWorkgroupSize[ 0 ] ),
		};

		this.writeTraceRayDispatchSizeKernel = writeTraceRayDispatchSize( writeTraceRayDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		this.regenerateDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.regenerateDispatchBuffer.name = 'Dispatch Buffer for Regenerate Rays Kernel';

		this.materialDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.materialDispatchBuffer.name = 'Dispatch Buffer for Material Eval Kernel';

		const writeMaterialStageDispatchSizeParams = {
			regenerateKernelBuffer: storage( this.regenerateDispatchBuffer, 'uint' ),
			materialKernelBuffer: storage( this.materialDispatchBuffer, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			workgroupSize: uniform( this.escapedRayWorkgroupSize[ 0 ] ),
		};

		this.writeMaterialStageDispatchSizeKernel = writeMaterialStageDispatchSize( writeMaterialStageDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		const cleanQueuesParams = {
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			tileSize: uniform( new Vector2() ),
		};

		this.cleanQueuesKernel = cleanQueues( cleanQueuesParams ).computeKernel( [ 1, 1, 1 ] );

	}

	createMegakernel() {

		const megakernelShaderParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4' ),
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( this.dimensions ),
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),
			smoothNormals: uniform( 1 ),
			seed: uniform( 0 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// bvh and geometry definition
			geom_index: storage( this.geometry.index, 'uvec3' ).toReadOnly(),
			geom_position: storage( this.geometry.position, 'vec3' ).toReadOnly(),
			geom_normals: storage( this.geometry.normal, 'vec3' ).toReadOnly(),
			geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),
			bvh: storage( this.geometry.bvh, 'BVHNode' ).toReadOnly(),

			materials: storage( this.geometry.materials, 'Material' ).toReadOnly(),

			// compute variables
			globalId: globalId,
		};

		this.megakernel = megakernelShader( this.bounces )( megakernelShaderParams ).computeKernel( this.WORKGROUP_SIZE );

	}

	createResetKernel() {

		const resetParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4f' ),
			dimensions: uniform( this.dimensions ),
			sampleCountBuffer: storage( this.sampleCountBuffer, 'u32' ),

			globalId: globalId,
		};


		this.resetKernel = resetResultFn( resetParams ).computeKernel( this.WORKGROUP_SIZE );

	}

	createLogicKernel() {

		const logicParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4' ),
			sampleCountBuffer: storage( this.sampleCountBuffer, 'u32' ),

			pathState: storage( this.pathState, 'PathState' ),
			regeneratePathQueue: storage( this.regeneratePathQueue, 'uint' ),
			materialEvalQueue: storage( this.materialEvalQueue, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),

			maxBounces: uniform( this.bounces ),
			tileOffset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( this.dimensions ),
			globalId: globalId,
		};

		this.logicKernel = logic( logicParams ).computeKernel( this.escapedRayWorkgroupSize );

	}

	createTraceRayKernel() {

		const traceRayParams = {
			pathState: storage( this.pathState, 'PathState' ),
			inputQueue: storage( this.extensionRayQueue, 'uint' ).toReadOnly(),
			queueSizes: storage( this.queueSizes, 'uint' ).toReadOnly(),

			geom_index: storage( this.geometry.index, 'uvec3' ).toReadOnly(),
			geom_position: storage( this.geometry.position, 'vec3' ).toReadOnly(),
			geom_normals: storage( this.geometry.normal, 'vec3' ).toReadOnly(),
			bvh: storage( this.geometry.bvh, 'BVHNode' ).toReadOnly(),

			globalId: globalId,
			localId: localId,
		};

		this.traceRayKernel = traceRay( traceRayParams ).computeKernel( this.traceRayWorkgroupSize );

	}

	createBsdfEvalKernel() {

		const bsdfEvalParams = {
			pathState: storage( this.pathState, 'PathState' ),
			inputQueue: storage( this.materialEvalQueue, 'uint' ).toReadOnly(),
			extensionRayQueue: storage( this.extensionRayQueue, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			normals: storage( this.geometry.normal, 'vec3' ).toReadOnly(),
			materials: storage( this.geometry.materials, 'Material' ).toReadOnly(),
			seed: uniform( 0 ),

			globalId: globalId,
			localId: localId,
		};

		this.bsdfEvalKernel = bsdfEval( bsdfEvalParams ).computeKernel( this.bsdfEvalWorkgroupSize );

	}

	setUseMegakernel( value ) {

		this.useMegakernel = value;
		this.reset();

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

		this.createMegakernel();
		this.createBsdfEvalKernel();
		this.createTraceRayKernel();

	}

	setCamera( camera ) {

		this.camera = camera;

	}

	setSize( w, h ) {

		w = 1920;
		h = 1080;

		w = Math.ceil( w );
		h = Math.ceil( h );

		if ( this.dimensions.x === w && this.dimensions.y === h ) {

			return;

		}

		this.bufferCount = ( this.bufferCount ?? 0 ) + 1;
		this.dimensions.set( w, h );

		try {

			this._renderer.destroyAttribute( this.resultBuffer );
			this._renderer.destroyAttribute( this.sampleCountBuffer );

		} catch ( e ) {

			console.log( 'Failed to destroy result buffer. Pbbly there was no gpu buffer for it' );

		}

		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 * w * h ) );
		this.resultBuffer.name = `Result Image #${this.bufferCount}`;
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( w * h ) );
		this.sampleCountBuffer.name = 'Sample Counts';

		this.createResetKernel();
		this.createLogicKernel();
		this.createMegakernel();

		this.reset();

	}

	getSize( target ) {

		target.copy( this.dimensions );

	}

	setTiles( tiles ) {

		this.tiles.copy( tiles );

	}

	getTileSize( target ) {

		target.copy( this.dimensions ).divide( this.tiles ).ceil();

		return target;

	}

	dispose() {

		// TODO: dispose of all buffers
		this._task = null;

	}

	reset() {

		const { _renderer } = this;

		const dispatchSize = [
			Math.ceil( this.dimensions.x / this.WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( this.dimensions.y / this.WORKGROUP_SIZE[ 1 ] ),
			1
		];

		_renderer.compute( this.resetKernel, dispatchSize );

		this.megakernelParams.seed.value = 0;
		this.generateRaysParams.seed.value = 0;

		this.samples = 0;
		this.currentTile = 0;
		this._task = null;

	}

	update() {

		if ( ! this.camera ) {

			return;

		}

		const tileSize = this.getTileSize( new Vector2() );
		const currentTileVec = new Vector2(
			this.currentTile % this.tiles.x,
			Math.floor( this.currentTile / this.tiles.x )
		);
		const offset = currentTileVec.multiply( tileSize );

		this.megakernelParams.seed.value += 1;
		this.megakernelParams.offset.value.copy( offset );
		this.megakernelParams.tileSize.value.copy( tileSize );
		this.megakernelParams.dimensions.value.copy( this.dimensions );
		this.megakernelParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.megakernelParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		this.logicParams.maxBounces.value = this.bounces;
		this.logicParams.tileOffset.value.copy( offset );
		this.logicParams.tileSize.value.copy( tileSize );
		this.logicParams.dimensions.value.copy( this.dimensions );
		this.generateRaysParams.seed.value += 1;
		this.generateRaysParams.tileOffset.value.copy( offset );
		this.generateRaysParams.tileSize.value.copy( tileSize );
		this.generateRaysParams.dimensions.value.copy( this.dimensions );
		this.generateRaysParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.generateRaysParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );
		this.cleanQueuesKernel.computeNode.parameters.tileSize.value.copy( tileSize );

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
