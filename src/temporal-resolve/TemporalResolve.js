import { HalfFloatType, LinearFilter, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass';
import { ComposeTemporalResolveMaterial } from './materials/ComposeTemporalResolveMaterial';
import { TemporalResolvePass } from './passes/TemporalResolvePass';

export class TemporalResolve {

	constructor( ptRenderer, scene, camera ) {

		this.ptRenderer = ptRenderer;
		this.scene = scene;

		this.temporalResolveMix = 0.75;
		this.clampRing = 1;
		this.newSamplesSmoothing = 0.5;
		this.newSamplesCorrection = 0.75;

		this.fullscreenMaterial = new ComposeTemporalResolveMaterial();

		this.fsQuad = new FullScreenQuad( this.fullscreenMaterial );

		this.renderTarget = new WebGLRenderTarget(
			typeof window !== 'undefined' ? window.innerWidth : 2000,
			typeof window !== 'undefined' ? window.innerHeight : 1000,
			{
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				type: HalfFloatType,
				depthBuffer: false,
			}
		);

		this.lastSize = { width: 0, height: 0 };

		this.initNewCamera( camera );
		this.initNewSize( window.innerWidth, window.innerHeight );

	}

	initNewCamera( camera ) {

		this.activeCamera = camera;

		this.temporalResolvePass = new TemporalResolvePass(
			this.ptRenderer,
			this.scene,
			camera
		);
		this.temporalResolvePass.fullscreenMaterial.uniforms.samplesTexture.value =
			this.ptRenderer.target.texture;

		this.fullscreenMaterial.uniforms.temporalResolveTexture.value =
			this.temporalResolvePass.renderTarget.texture;

	}

	initNewSize( width, height ) {

		this.lastSize.width = width;
		this.lastSize.height = height;

		this.temporalResolvePass.setSize( width, height );

	}

	get target() {

		return this.renderTarget;

	}

	update() {

		const renderer = this.ptRenderer._renderer;

		const origRenderTarget = renderer.getRenderTarget();

		const { camera } = this.ptRenderer;
		if ( camera !== this.activeCamera ) {

			this.initNewCamera( camera );

		}

		const { width, height } = this.ptRenderer.target;
		if ( width !== this.lastSize.width || height !== this.lastSize.height ) {

			this.initNewSize( width, height );

		}

		// ensure that the scene's objects' matrices are updated for the VelocityPass
		this.scene.updateMatrixWorld();

		this.scene.traverse( ( c ) => {

			// update the modelViewMatrix which is used by the VelocityPass
			c.modelViewMatrix.multiplyMatrices(
				this.activeCamera.matrixWorldInverse,
				c.matrixWorld
			);

		} );

		// keep uniforms updated
		this.temporalResolvePass.fullscreenMaterial.uniforms.samples.value =
			this.ptRenderer.samples;

		this.temporalResolvePass.fullscreenMaterial.uniforms.temporalResolveMix.value =
			this.temporalResolveMix;

		this.temporalResolvePass.fullscreenMaterial.uniforms.clampRing.value =
			parseInt( this.clampRing );

		this.temporalResolvePass.fullscreenMaterial.uniforms.newSamplesSmoothing.value =
			this.newSamplesSmoothing;

		this.temporalResolvePass.fullscreenMaterial.uniforms.newSamplesCorrection.value =
			this.newSamplesCorrection;

		this.temporalResolvePass.render( renderer );

		renderer.setRenderTarget( this.renderTarget );
		this.fsQuad.render( renderer );

		renderer.setRenderTarget( origRenderTarget );

	}

}
