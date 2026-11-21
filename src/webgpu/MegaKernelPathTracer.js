import { Vector2 } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { FILTER_GLOSSY_DISABLED } from './nodes/material.wgsl.js';
import { PathTracerBackend } from './PathTracerBackend.js';

const _size = new Vector2();

export class MegaKernelPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// every pixel in a tile finishes its sample in one dispatch, so the counts follow from how
		// far through the tile cycle the render is and need no GPU work to measure
		this._completedSamples = 0;
		this._tileProgress = 0;

		// kernels
		this.kernel = new PathTracerMegaKernel( ).setWorkgroupSize( 8, 8, 1 );
		this.kernel.context.clampDirect = this.clampDirect;
		this.kernel.context.clampIndirect = this.clampIndirect;

	}

	resetSeed() {

		this.kernel.globalSeed = 0;

	}

	reset() {

		super.reset();
		this.kernel.globalSeed ++;
		this._completedSamples = 0;
		this._tileProgress = 0;

	}

	async getSampleCountsAsync() {

		if ( this.lowResMode ) {

			return { min: 0, max: 0, avg: 0 };

		}

		const completed = this._completedSamples;
		const progress = this._tileProgress;

		return {
			min: progress === 1 ? completed + 1 : completed,
			max: completed + 1,
			avg: completed + progress,
		};

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

		// Number of tile cycles that have finished, ie. the sample count every pixel has reached. It is the sample
		// index of the next cycle, as in the wavefront, and the global seed gives each render its own sequence
		let completedSamples = 0;

		// the tile of the current cycle dispatched next, and the cycle's grid of tiles. Every pixel in a tile finishes
		// its sample in a single dispatch, so the sample counts can be derived from how far through the tile cycle we
		// are without reading anything back
		let tileIndex = 0;
		let tileCount = 1;
		let dispatchSize = null;
		const tileSize = kernel.tileSize;

		// a cycle splits the frame into a near square grid of tiles no larger than the budget
		const startCycle = () => {

			this.getSize( _size );
			const budgetTiles = lowResMode ? 1 : Math.max( 1, Math.ceil( _size.x * _size.y / this.frameBudget ) );
			tiles.x = Math.ceil( Math.sqrt( budgetTiles ) );
			tiles.y = Math.ceil( budgetTiles / tiles.x );
			tileCount = tiles.x * tiles.y;

			this.getSize( tileSize ).divide( tiles ).ceil();
			dispatchSize = kernel.getDispatchSize( tileSize.x, tileSize.y );
			kernel.sampleIndex = completedSamples;

		};

		while ( true ) {

			// skip the tile loop entirely once every pixel is finished
			kernel.maxSamples = this.maxSamples;
			kernel.auxTarget = this.auxTarget ?? this._auxPlaceholder;
			kernel.accumulateAux = this.auxTarget ? 1 : 0;
			if ( this.maxSamples !== 0 && completedSamples >= this.maxSamples ) {

				yield;
				continue;

			}

			if ( tileIndex === 0 ) {

				startCycle();

			}

			// the tiles that fit in the budget, so a budget past the pixel count runs several tile cycles. Every update
			// takes at least one, and the low res preview only one
			const updateTiles = lowResMode ? 1 : Math.max( 1, Math.floor( this.frameBudget / ( tileSize.x * tileSize.y ) ) );
			for ( let i = 0; i < updateTiles; i ++ ) {

				kernel.offset.set( tileIndex % tiles.x, Math.floor( tileIndex / tiles.x ) ).multiply( tileSize );
				this.dispatch( kernel, dispatchSize );

				tileIndex ++;
				this._completedSamples = completedSamples;
				this._tileProgress = tileIndex / tileCount;

				if ( tileIndex === tileCount ) {

					tileIndex = 0;
					completedSamples ++;

					// the update's next tile starts a new cycle, unless every pixel is finished
					if ( this.maxSamples !== 0 && completedSamples >= this.maxSamples ) {

						break;

					}

					startCycle();

				}

			}

			yield;

		}

	}

	dispose() {

		super.dispose();

		// TODO: dispose of all buffers
		this.kernel.dispose();

	}

}
