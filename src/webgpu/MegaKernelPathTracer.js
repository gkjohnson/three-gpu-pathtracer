import { StorageBufferAttribute, StorageTexture, Vector2, FloatType, RGBAFormat, LinearFilter, RedIntegerFormat, UnsignedIntType, ColorManagement } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { ZeroOutKernel } from './compute/ZeroOutKernel.js';

function* renderTask() {

	const {
		renderer,
		camera,
		kernel,
		geometry,
		bounces,

		tiles,
		outputTarget,
		sampleCountTarget,
	} = this;

	camera.updateMatrixWorld();

	// init parameters
	kernel.outputTarget = outputTarget;
	kernel.sampleCountTarget = sampleCountTarget;

	kernel.geom_index = geometry.index;
	kernel.geom_position = geometry.position;
	kernel.geom_normals = geometry.normal;
	kernel.geom_material_index = geometry.materialIndex;
	kernel.bvh = geometry.bvh;
	kernel.materials = geometry.materials;

	kernel.bounces = bounces;
	kernel.inverseProjectionMatrix.copy( camera.projectionMatrixInverse );
	kernel.cameraToModelMatrix.copy( camera.matrixWorld );

	while ( true ) {

		const tileSize = this.getTileSize( kernel.tileSize );
		const dispatchSize = kernel.getDispatchSize( tileSize.x, tileSize.y );
		kernel.seed += 1;

		for ( let x = 0; x < tiles.x; x ++ ) {

			for ( let y = 0; y < tiles.y; y ++ ) {

				kernel.offset.set( x, y ).multiply( tileSize );
				renderer.compute( kernel.kernel, dispatchSize );
				yield;

			}

		}

		this.samples ++;

	}

}

export class MegaKernelPathTracer {

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

		// kernels
		this.kernel = new PathTracerMegaKernel().setWorkgroupSize( 8, 8, 1 );
		this.sampleCountClearKernel = new ZeroOutKernel( { textureType: 'r32uint' } ).setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel( { textureType: 'rgba32float' } ).setWorkgroupSize( 8, 8, 1 );

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

		this.samples = 0;
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
