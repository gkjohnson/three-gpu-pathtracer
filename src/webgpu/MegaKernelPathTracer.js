import { Matrix4, Vector2 } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { EquirectHdrInfoNode } from './EquirectHdrInfoNode.js';
import { EquirectBackgroundInfo } from './EquirectBackgroundInfo.js';
import { FILTER_GLOSSY_DISABLED } from './nodes/material.wgsl.js';
import { PathTracerBackend } from './PathTracerBackend.js';

export class MegaKernelPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.tiles = new Vector2( 2, 2 );
		this.envInfo = new EquirectHdrInfoNode();
		this.samples = 0;

		// kernels
		this.kernel = new PathTracerMegaKernel( ).setWorkgroupSize( 8, 8, 1 );
		this.kernel.envInfo = this.envInfo;

		this.backgroundInfo = new EquirectBackgroundInfo();
		this.kernel.backgroundInfo = this.backgroundInfo;

	}

	resetSeed() {

		this.kernel.seed = 0;

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

	setEnvironment( envMap ) {

		this.envInfo.updateFrom( envMap );

	}

	setMultipleImportanceSampling( enabled ) {

		this.kernel.misEnabled = enabled ? 1 : 0;
		this.reset();

	}

	setEnvironmentParams( envMapIntensity, envMapRotation ) {

		const { envInfo } = this;
		const rotationMatrix = new Matrix4().makeRotationFromEuler( envMapRotation ).invert();
		envInfo.rotationNode.value.setFromMatrix4( rotationMatrix );
		envInfo.intensityNode.value = envMapIntensity;

	}

	setBackground( background ) {

		const { backgroundInfo } = this;
		backgroundInfo.dispose();
		backgroundInfo.map = background;

	}

	setBackgroundParams(
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

		const { backgroundInfo } = this;
		const rotationMatrix = new Matrix4().makeRotationFromEuler( backgroundRotation ).invert();
		backgroundInfo.rotationNode.value.copy( rotationMatrix );
		backgroundInfo.intensity = backgroundIntensity;
		backgroundInfo.blur = backgroundBlurriness;

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

		while ( true ) {

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
					yield;

				}

			}

			this.samples ++;

		}

	}

	dispose() {

		super.dispose();

		// TODO: dispose of all buffers
		this.envInfo.dispose();

	}

}
