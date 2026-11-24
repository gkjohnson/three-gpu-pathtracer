import { Vector2 } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { FILTER_GLOSSY_DISABLED } from './nodes/material.wgsl.js';
import { PathTracerBackend } from './PathTracerBackend.js';

const _size = new Vector2();

export class MegaKernelPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// kernels
		this.kernel = new PathTracerMegaKernel( ).setWorkgroupSize( 8, 8, 1 );
		this.kernel.context.clampDirect = this.clampDirect;
		this.kernel.context.clampIndirect = this.clampIndirect;

	}

	setBVHData( bvhData ) {

		this.kernel.context.bvhData = bvhData;
		this.rebuild();

	}

	rebuild() {

		super.rebuild();
		this.kernel.needsUpdate = true;
		this.reset();

	}

	setRandom( random ) {

		this.kernel.context.random = random;
		this.rebuild();

	}

	setShadingModel( shadingModel ) {

		this.kernel.context.shadingModel = shadingModel;
		this.rebuild();

	}

	setFilterGlossy( value ) {

		// the kernel takes the inverted threshold, mirroring Cycles
		this.kernel.filterGlossy = value === 0 ? FILTER_GLOSSY_DISABLED : 1 / value;
		this.reset();

	}

	setLightsInfo( lightsInfo ) {

		this.kernel.lightsInfo = lightsInfo;
		this.kernel.envInfo = lightsInfo.envInfo;
		this.rebuild();

	}

	setMultipleImportanceSampling( enabled ) {

		this.kernel.misEnabled = enabled ? 1 : 0;
		this.reset();

	}

	setBackgroundInfo( backgroundInfo ) {

		this.kernel.backgroundInfo = backgroundInfo;
		this.rebuild();

	}

	setTransmissiveBackground( value ) {

		this.kernel.transmissiveBackground = value;
		this.reset();

	}

	*createRenderTask() {

		const {
			kernel,
			maxBounces,
			maxTransparentBounces,
			maxSubsurfaceBounces,
			maxFogBounces,
			cameraInVolume,

			outputTarget,
			sampleCountTarget,
			lowResMode,
		} = this;

		const tiles = new Vector2();

		// init parameters
		kernel.outputTarget = outputTarget;
		kernel.sampleCountTarget = sampleCountTarget;

		kernel.maxBounces = maxBounces;
		kernel.maxTransparentBounces = maxTransparentBounces;
		kernel.maxSubsurfaceBounces = maxSubsurfaceBounces;
		kernel.maxFogBounces = maxFogBounces;
		kernel.cameraInVolume = Number( cameraInVolume );

		// compile the kernel before its first dispatch
		yield* this.compileKernels( [ kernel ] );

		// each render gets its own seed without "stableNoise"
		kernel.globalSeed = this.stableNoise ? 0 : kernel.globalSeed + 1;

		// Number of tile cycles that have finished, ie. the sample count every pixel has reached
		let completedSamples = 0;

		// the dispatches of the current update
		let updateDispatches = 0;

		while ( true ) {

			// skip the tile loop entirely once every pixel is finished
			kernel.maxSamples = this.maxSamples;
			kernel.auxTarget = this.auxTarget ?? this._auxPlaceholder;
			kernel.accumulateAux = this.auxTarget ? 1 : 0;
			if ( this.maxSamples !== 0 && completedSamples >= this.maxSamples ) {

				updateDispatches = 0;
				yield;
				continue;

			}

			// split the frame into a near square grid of tiles no larger than the budget
			this.getSize( _size );
			const budgetTiles = lowResMode ? 1 : Math.max( 1, Math.ceil( _size.x * _size.y / this.frameBudget ) );
			tiles.x = Math.ceil( Math.sqrt( budgetTiles ) );
			tiles.y = Math.ceil( budgetTiles / tiles.x );

			const tileCount = this.lowResMode ? 1 : tiles.x * tiles.y;

			const tileSize = kernel.tileSize;
			if ( lowResMode ) {

				this.getSize( tileSize );

			} else {

				this.getSize( tileSize ).divide( tiles ).ceil();

			}

			const dispatchSize = kernel.getDispatchSize( tileSize.x, tileSize.y );

			// a frame rendered in one tile takes as many samples per update as fit in the budget
			let updateSamples = 1;
			if ( tileCount === 1 && ! lowResMode ) {

				updateSamples = Math.max( 1, Math.floor( this.frameBudget / ( _size.x * _size.y ) ) );

			}

			for ( let x = 0; x < tiles.x; x ++ ) {

				for ( let y = 0; y < tiles.y; y ++ ) {

					kernel.offset.set( x, y ).multiply( tileSize );
					this.dispatch( kernel, dispatchSize );

					updateDispatches ++;
					if ( updateDispatches >= updateSamples ) {

						updateDispatches = 0;
						yield;

					}

				}

			}

			completedSamples ++;

		}

	}

	dispose() {

		super.dispose();

		// TODO: dispose of all buffers
		this.kernel.dispose();

	}

}
