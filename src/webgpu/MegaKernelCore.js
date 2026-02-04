import { StorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';

function* renderTask() {

	const tileSize = new Vector2();

	const {
		megakernel,
		renderer,
		WORKGROUP_SIZE,
		geometry,
		bounces,

		outputTarget,
		sampleCountTarget,
	} = this;

	const { parameters } = megakernel.computeNode;
	parameters.outputTarget.value = outputTarget;
	parameters.sampleCountTarget.value = sampleCountTarget;

	parameters.geom_index.value = geometry.index;
	parameters.geom_position.value = geometry.position;
	parameters.geom_normals.value = geometry.normal;
	parameters.geom_material_index.value = geometry.materialIndex;
	parameters.bvh.value = geometry.bvh;
	parameters.materials.value = geometry.materials;

	parameters.bounces.value = bounces;

	while ( true ) {

		// TODO: iterate over all tiles here in addition to reading and updating settings
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
		this.megakernelParams.inverseProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
		this.megakernelParams.cameraToModelMatrix.value.copy( this.camera.matrixWorld );

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

		this.currentTile = ( this.currentTile + 1 ) % ( this.tiles.x * this.tiles.y );

	}

}
