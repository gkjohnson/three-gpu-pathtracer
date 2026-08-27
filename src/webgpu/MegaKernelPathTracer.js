import { Matrix4, Vector2 } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { FILTER_GLOSSY_DISABLED } from './nodes/material.wgsl.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { PathTracerBackend } from './PathTracerBackend.js';

export class MegaKernelPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.tiles = new Vector2( 2, 2 );
		this.envInfo = new EquirectHdrInfoUniform();

		// every pixel in a tile finishes its sample in one dispatch, so the counts follow from how
		// far through the tile cycle the render is and need no GPU work to measure
		this._completedSamples = 0;
		this._tileProgress = 0;

		// kernels
		this.kernel = new PathTracerMegaKernel( ).setWorkgroupSize( 8, 8, 1 );

	}

	resetSeed() {

		this.kernel.seed = 0;

	}

	reset() {

		super.reset();
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

		this.kernel.bvhData = bvhData;
		this.rebuild();

	}

	rebuild() {

		super.rebuild();
		this.kernel.needsUpdate = true;
		this.reset();

	}

	setRandom( random ) {

		this.kernel.context.random = random;
		this.kernel.needsUpdate = true;
		this.reset();

	}

	setMaterial( material ) {

		this.kernel.material = material.getData();
		this.kernel.needsUpdate = true;
		this.reset();

	}

	setFilterGlossy( value ) {

		// the kernel takes the inverted threshold, mirroring Cycles
		this.kernel.filterGlossy = value === 0 ? FILTER_GLOSSY_DISABLED : 1 / value;
		this.reset();

	}

	setClamping( direct, indirect ) {

		this.kernel.clampDirect = direct;
		this.kernel.clampIndirect = indirect;
		this.reset();

	}

	setEnvironment( envMap ) {

		const { kernel, envInfo } = this;
		envInfo.updateFrom( envMap );
		kernel.envMap = envInfo.map;
		kernel.kernel.computeNode.parameters.envMapSampler.node.value = envInfo.map;

	}

	setEnvironmentParams( envMapIntensity, envMapRotation ) {

		const { kernel } = this;
		const rotationMatrix = new Matrix4().makeRotationFromEuler( envMapRotation ).invert();
		kernel.envMapRotation.setFromMatrix4( rotationMatrix );
		kernel.envMapIntensity = envMapIntensity;

	}

	setBackground( background ) {

		const { kernel } = this;
		if ( kernel.background.isTexture ) {

			kernel.background.dispose();

		}

		kernel.background = background;
		kernel.kernel.computeNode.parameters.backgroundSampler.node.value = background;

	}

	setBackgroundParams(
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

		const { kernel } = this;
		const rotationMatrix = new Matrix4().makeRotationFromEuler( backgroundRotation ).invert();
		kernel.backgroundRotation.setFromMatrix4( rotationMatrix );
		kernel.backgroundIntensity = backgroundIntensity;
		kernel.backgroundBlurriness = backgroundBlurriness;

	}

	setTransmissiveBackground( value ) {

		this.kernel.transmissiveBackground = value;
		this.reset();

	}

	setTiles( tiles ) {

		this.tiles.copy( tiles );

	}

	*createRenderTask() {

		const {
			renderer,
			kernel,
			bounces,

			tiles,
			outputTarget,
			sampleCountTarget,
			lowResMode,
		} = this;

		// init parameters
		kernel.outputTarget = outputTarget;
		kernel.sampleCountTarget = sampleCountTarget;

		kernel.bounces = bounces;

		// number of tile cycles that have finished, ie. the sample count every pixel has reached
		let completedSamples = 0;

		while ( true ) {

			// skip the tile loop entirely once every pixel is finished
			kernel.maxSamples = this.maxSamples;
			if ( this.maxSamples !== 0 && completedSamples >= this.maxSamples ) {

				yield;
				continue;

			}

			// every pixel in a tile finishes its sample in a single dispatch, so the sample counts
			// can be derived from how far through the tile cycle we are without reading anything back
			const tileCount = this.lowResMode ? 1 : tiles.x * tiles.y;
			let completedTiles = 0;

			const tileSize = kernel.tileSize;
			if ( lowResMode ) {

				this.getSize( tileSize );

			} else {

				this.getSize( tileSize ).divide( tiles ).ceil();

			}

			const dispatchSize = kernel.getDispatchSize( tileSize.x, tileSize.y );
			kernel.seed += 1;

			// Swap targets to support devices without <rgba32float, read_write> textures
			// Copy latest data to a new outputTarget to keep the appearance
			renderer.copyTextureToTexture( this.outputTarget, this.prevOutputTarget );
			[ this.outputTarget, this.prevOutputTarget ] = [ this.prevOutputTarget, this.outputTarget ];
			kernel.prevOutputTarget = this.prevOutputTarget;
			kernel.outputTarget = this.outputTarget;

			for ( let x = 0; x < tiles.x; x ++ ) {

				for ( let y = 0; y < tiles.y; y ++ ) {

					kernel.offset.set( x, y ).multiply( tileSize );
					renderer.compute( kernel.kernel, dispatchSize );

					// in low res mode the tiles past the first fall outside the target and do no work
					completedTiles = Math.min( completedTiles + 1, tileCount );
					this._completedSamples = completedSamples;
					this._tileProgress = completedTiles / tileCount;

					yield;

				}

			}

			completedSamples ++;

		}

	}

	dispose() {

		super.dispose();

		// TODO: dispose of all buffers
		this.envInfo.dispose();

	}

}
