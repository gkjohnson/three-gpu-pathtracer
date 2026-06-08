import { Matrix4, Vector2 } from 'three/webgpu';
import { PathTracerMegaKernel } from './compute/PathTracerMegaKernel.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { PathTracerBackend } from './PathTracerBackend.js';

export class MegaKernelPathTracer extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		// options
		this.tiles = new Vector2( 2, 2 );
		this.envInfo = new EquirectHdrInfoUniform();
		this.samples = 0;

		// kernels
		this.kernel = new PathTracerMegaKernel( ).setWorkgroupSize( 8, 8, 1 );

	}

	setBVHData( bvhData ) {

		this.kernel.bvhData = bvhData;
		this.kernel.needsUpdate = true;
		this.reset();

	}

	setTextures( texture ) {

		this.kernel.textures = texture;
		this.kernel.kernel.computeNode.parameters.textureSampler.node.value = texture;
		this.reset();

	}

	setMaterial( material ) {

		this.kernel.material = material.getData();
		this.kernel.needsUpdate = true;
		this.reset();

	}

	setEnvironment(
		envMap,
		envMapIntensity,
		envMapRotation,

		background,
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

		const { kernel } = this;

		if ( kernel.background.isTexture ) {

			kernel.background.dispose();

		}

		if ( envMap !== null ) {

			this.envInfo.updateFrom( envMap );
			kernel.envMap = this.envInfo.map;
			kernel.kernel.computeNode.parameters.envMapSampler.node.value = this.envInfo.map;

		}

		const rotationMatrix = new Matrix4().makeRotationFromEuler( envMapRotation ).invert();
		kernel.envMapRotation.setFromMatrix4( rotationMatrix );
		kernel.envMapIntensity = envMapIntensity;

		kernel.background = background;
		kernel.kernel.computeNode.parameters.backgroundSampler.node.value = background;
		rotationMatrix.makeRotationFromEuler( backgroundRotation ).invert();
		kernel.backgroundRotation.setFromMatrix4( rotationMatrix );
		kernel.backgroundIntensity = backgroundIntensity;
		kernel.backgroundBlurriness = backgroundBlurriness;

	}

	setTiles( tiles ) {

		this.tiles.copy( tiles );

	}

	*createRenderTask() {

		const {
			renderer,
			camera,
			kernel,
			bounces,

			tiles,
			outputTarget,
			sampleCountTarget,
			lowResMode,
		} = this;

		camera.updateMatrixWorld();

		// init parameters
		kernel.outputTarget = outputTarget;
		kernel.sampleCountTarget = sampleCountTarget;

		kernel.bounces = bounces;
		kernel.inverseProjectionMatrix.copy( camera.projectionMatrixInverse );
		kernel.cameraToModelMatrix.copy( camera.matrixWorld );

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
