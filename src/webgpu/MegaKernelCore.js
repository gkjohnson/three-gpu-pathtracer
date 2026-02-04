import { StorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';

function* renderTask() {

	const tileSize = new Vector2();

	const {
		megakernel,
		renderer,
		WORKGROUP_SIZE,
		resultBuffer,
		sampleCountBuffer,
		geometry,
		dimensions,
		bounces,

		resultBuffer2,
		sampleCountBuffer2,
	} = this;

	const { parameters } = megakernel.computeNode;
	parameters.resultBuffer.value = resultBuffer;
	parameters.sampleCountBuffer.value = sampleCountBuffer;

	parameters.resultBuffer2.value = resultBuffer2;
	parameters.sampleCountBuffer2.value = sampleCountBuffer2;

	parameters.geom_index.value = geometry.index;
	parameters.geom_position.value = geometry.position;
	parameters.geom_normals.value = geometry.normal;
	parameters.geom_material_index.value = geometry.materialIndex;
	parameters.bvh.value = geometry.bvh;
	parameters.materials.value = geometry.materials;

	parameters.dimensions.value.copy( dimensions );
	parameters.bounces.value = bounces;

	while ( true ) {

		this.getTileSize( tileSize );

		renderer.info.reset();

		const dispatchSize = [
			Math.ceil( tileSize.x / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( tileSize.y / WORKGROUP_SIZE[ 1 ] ),
			1
		];

		renderer.compute( megakernel.kernel, dispatchSize );
		this.samples ++;
		yield;

	}

}

export class MegaKernelCore {

	get megakernelParams() {

		return this.megakernel.computeNode.parameters;

	}

	get traceRayParams() {

		return this.traceRayKernel.computeNode.parameters;

	}

	constructor( renderer ) {

		this.camera = null;
		this.renderer = renderer;
		this._task = null;

		this.samples = 0;
		this.bounces = 7;

		this.tiles = new Vector2( 2, 2 );
		this.tileSize = new Vector2();
		this.currentTile = 0;

		this.dimensions = new Vector2();

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

		this.resultBuffer2 = new StorageTexture( 1, 1, );
		this.resultBuffer2.format = RGBAFormat;
		this.resultBuffer2.type = FloatType;
		this.resultBuffer2.magFilter = LinearFilter;

		this.sampleCountBuffer2 = new StorageTexture( 1, 1, );
		this.sampleCountBuffer2.format = RedIntegerFormat;
		this.sampleCountBuffer2.type = UnsignedIntType;

		this.WORKGROUP_SIZE = [ 8, 8, 1 ];
		this.createMegakernel();

	}

	createMegakernel() {

		this.megakernel = new PathTracerMegaKernel().setWorkgroupSize( ...this.WORKGROUP_SIZE );

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

		// TODO: cannot dispose StorageBufferAttribute at the moment
		// this.sampleCountBuffer.dispose();
		// this.resultBuffer.dispose();
		this.resultBuffer = new StorageBufferAttribute( new Float32Array( 4 * w * h ) );
		this.resultBuffer.name = `Result Image #${this.bufferCount}`;
		this.sampleCountBuffer = new StorageBufferAttribute( new Uint32Array( w * h ) );
		this.sampleCountBuffer.name = 'Sample Counts';

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

		this.megakernelParams.seed.value = 0;

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
