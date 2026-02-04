import { StorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';

function* renderTask() {

	const {
		renderer,
		camera,
		megakernel,
		geometry,
		bounces,

		tiles,
		outputTarget,
		sampleCountTarget,
	} = this;

	camera.updateMatrixWorld();

	// init parameters
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
	parameters.inverseProjectionMatrix.value.copy( camera.projectionMatrixInverse );
	parameters.cameraToModelMatrix.value.copy( camera.matrixWorld );

	while ( true ) {

		const tileSize = this.getTileSize( parameters.tileSize.value );
		const dispatchSize = megakernel.getDispatchSize( tileSize.x, tileSize.y );
		parameters.seed.value += 1;

		for ( let x = 0; x < tiles.x; x ++ ) {

			for ( let y = 0; y < tiles.y; y ++ ) {

				parameters.offset.value.set( x, y ).multiply( tileSize );
				renderer.compute( megakernel.kernel, dispatchSize );
				yield;

			}

		}

		this.samples ++;

	}

}

export class MegaKernelCore {

	get megakernelParams() {

		return this.megakernel.computeNode.parameters;

	}

	constructor( renderer ) {

		this.camera = null;
		this.renderer = renderer;
		this._task = null;

		this.samples = 0;
		this.bounces = 7;

		this.tiles = new Vector2( 2, 2 );

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

		this.sampleCountClearKernel = new ZeroOutKernel( { textureType: 'r32uint' } ).setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );

		this.megakernel = new PathTracerMegaKernel().setWorkgroupSize( 8, 8, 1 );

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

		const {
			renderer,
			sampleCountClearKernel,
			outputTargetClearKernel,
			sampleCountTarget,
			outputTarget,
		} = this;

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
