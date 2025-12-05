import { IndirectStorageBufferAttribute, StorageBufferAttribute, Matrix4, Vector2, TimestampQuery } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import megakernelShader from './nodes/megakernel.wgsl.js';
import resetResultFn from './nodes/reset.wgsl.js';
import {
	generateRays, traceRay, bsdfEval, escapedRay, cleanQueues,
	writeTraceRayDispatchSize, writeBsdfDispatchSize, writeEscapedRayDispatchSize,
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
			// 0. Clean queues
			_renderer.compute( this.cleanQueuesKernel, 1 );
			// 0.1 Generate one ray per pixel and write it into ray queue
			_renderer.compute( this.generateRaysKernel, dispatchSize );

			for ( let i = 0; i < this.bounces; i ++ ) {

				// 1. Trace rays from the ray queue
				// Traced ray can either hit something - then it goes into the hitResultQueue
				// If it doesn't hit anything it goes into the escapedRayQueue
				_renderer.compute( this.writeTraceRayDispatchSizeKernel, 1 );
				_renderer.compute( this.traceRayKernel, this.traceRayDispatchBuffer );

				// 2. Handle escaped and scattered rays
				// 2.1 Calcuate dispatch sizes and write it to gpu buffer
				_renderer.compute( this.writeEscapedRayDispatchSizeKernel, 1 );
				_renderer.compute( this.writeBsdfDispatchSizeKernel, 1 );
				// 2.1 Dispatch shaders
				// When processing escaped rays, calculate new contribution and add that to the result image
				_renderer.compute( this.escapedRayKernel, this.escapedRayDispatchBuffer );
				// When processing hit results, sample a new ray according to material's properties
				_renderer.compute( this.bsdfEvalKernel, this.bsdfDispatchBuffer );

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

	get escapedRayParams() {

		return this.escapedRayKernel.computeNode.parameters;

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
		const maxRayCount = 1920 * 1080;
		const queueSize = /* element storage */ 16 * maxRayCount;
		this.rayQueue = new StorageBufferAttribute( new Uint32Array( queueSize ) );
		this.rayQueue.name = 'Ray Queue';

		// [rayQueueSize, hitResultQueueSize, escapedRayQueueSize]
		this.queueSizes = new StorageBufferAttribute( new Uint32Array( 3 ) );
		this.queueSizes.name = 'Queue Sizes';

		this.escapedQueue = new StorageBufferAttribute( new Uint32Array( 16 * maxRayCount ) );
		this.escapedQueue.name = 'Escaped Rays Queue';

		this.hitResultQueue = new StorageBufferAttribute( new Uint32Array( 16 * maxRayCount ) );
		this.hitResultQueue.name = 'Hit Result Queue';

		this.WORKGROUP_SIZE = [ 8, 8, 1 ];
		this.bsdfEvalWorkgroupSize = [ 128, 1, 1 ];
		this.traceRayWorkgroupSize = [ 128, 1, 1 ];
		this.escapedRayWorkgroupSize = [ 128, 1, 1 ];

		this.createMegakernel();
		this.createResetKernel();

		const generateRaysParams = {

			cameraToModelMatrix: uniform( new Matrix4() ),
			inverseProjectionMatrix: uniform( new Matrix4() ),
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( this.dimensions ),

			rayQueue: storage( this.rayQueue, 'RayQueueElement' ),
			rayQueueSize: storage( this.queueSizes, 'uint' ).toAtomic(),

			globalId: globalId,

		};

		this.generateRaysKernel = generateRays( generateRaysParams ).computeKernel( this.WORKGROUP_SIZE );

		this.createTraceRayKernel();
		this.createEscapedRayKernel();
		this.createBsdfEvalKernel();

		this.traceRayDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.traceRayDispatchBuffer.name = 'Dispatch Buffer for Trace Ray';

		const writeTraceRayDispatchSizeParams = {
			outputBuffer: storage( this.traceRayDispatchBuffer, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			workgroupSize: uniform( this.traceRayWorkgroupSize[ 0 ] ),
		};

		this.writeTraceRayDispatchSizeKernel = writeTraceRayDispatchSize( writeTraceRayDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );
		this.escapedRayDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.escapedRayDispatchBuffer.name = 'Dispatch Buffer for Escaped Rays';

		const writeEscapedRayDispatchSizeParams = {
			outputBuffer: storage( this.escapedRayDispatchBuffer, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			workgroupSize: uniform( this.escapedRayWorkgroupSize[ 0 ] ),
		};

		this.writeEscapedRayDispatchSizeKernel = writeEscapedRayDispatchSize( writeEscapedRayDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		this.bsdfDispatchBuffer = new IndirectStorageBufferAttribute( new Uint32Array( 3 ) );
		this.bsdfDispatchBuffer.name = 'Dispatch Buffer for bsdf eval';
		const writeBsdfDispatchSizeParams = {
			outputBuffer: storage( this.bsdfDispatchBuffer, 'uint' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			workgroupSize: uniform( this.bsdfEvalWorkgroupSize[ 0 ] ),
		};

		this.writeBsdfDispatchSizeKernel = writeBsdfDispatchSize( writeBsdfDispatchSizeParams ).computeKernel( [ 1, 1, 1 ] );

		const cleanQueuesParams = {
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
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
			sample_count_buffer: storage( this.sampleCountBuffer, 'u32' ),

			globalId: globalId,
		};


		this.resetKernel = resetResultFn( resetParams ).computeKernel( this.WORKGROUP_SIZE );

	}

	createEscapedRayKernel() {

		const escapedRayParams = {
			resultBuffer: storage( this.resultBuffer, 'vec4' ),
			inputQueue: storage( this.escapedQueue, 'RayQueueElement' ).toReadOnly(),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			sampleCountBuffer: storage( this.sampleCountBuffer, 'u32' ),

			dimensions: uniform( this.dimensions ),
			globalId: globalId,
		};

		this.escapedRayKernel = escapedRay( escapedRayParams ).computeKernel( this.escapedRayWorkgroupSize );

	}

	createTraceRayKernel() {

		const traceRayParams = {
			inputQueue: storage( this.rayQueue, 'RayQueueElement' ).toReadOnly(),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),
			escapedQueue: storage( this.escapedQueue, 'RayQueueElement' ),
			outputQueue: storage( this.hitResultQueue, 'HitResultQueueElement' ),

			geom_index: storage( this.geometry.index, 'uvec3' ).toReadOnly(),
			geom_position: storage( this.geometry.position, 'vec3' ).toReadOnly(),
			geom_normals: storage( this.geometry.normal, 'vec3' ).toReadOnly(),
			// geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),
			bvh: storage( this.geometry.bvh, 'BVHNode' ).toReadOnly(),

			globalId: globalId,
		};

		this.traceRayKernel = traceRay( traceRayParams ).computeKernel( this.traceRayWorkgroupSize );

	}

	createBsdfEvalKernel() {

		const bsdfEvalParams = {
			inputQueue: storage( this.hitResultQueue, 'HitResultQueueElement' ).toReadOnly(),
			outputQueue: storage( this.rayQueue, 'RayQueueElement' ),
			queueSizes: storage( this.queueSizes, 'uint' ).toAtomic(),

			geom_material_index: storage( this.geometry.materialIndex, 'u32' ).toReadOnly(),
			materials: storage( this.geometry.materials, 'Material' ).toReadOnly(),
			seed: uniform( 0 ),

			globalId: globalId,
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
		this.createEscapedRayKernel();
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
		this.bsdfEvalParams.seed.value = 0;

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

		this.bsdfEvalParams.seed.value += 1;
		this.escapedRayParams.dimensions.value.copy( this.dimensions );
		this.generateRaysParams.offset.value.copy( offset );
		this.generateRaysParams.tileSize.value.copy( tileSize );
		this.generateRaysParams.dimensions.value.copy( this.dimensions );
		this.generateRaysParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.generateRaysParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

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
