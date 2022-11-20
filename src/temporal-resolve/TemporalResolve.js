﻿import { FloatType, LinearFilter, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ComposeTemporalResolveMaterial } from './materials/ComposeTemporalResolveMaterial.js';
import { TemporalResolvePass } from './passes/TemporalResolvePass.js';

export class TemporalResolve {

	get target() {

		return this.renderTarget;

	}

	constructor( ptRenderer, scene, camera ) {

		this.ptRenderer = ptRenderer;
		this.scene = scene;

		// parameters
		this.temporalResolveMix = 0.9;
		this.clampRadius = 1;
		this.newSamplesSmoothing = 0.675;
		this.newSamplesCorrection = 1;

		this.fullscreenMaterial = new ComposeTemporalResolveMaterial();

		this.fsQuad = new FullScreenQuad( this.fullscreenMaterial );

		this.renderTarget = new WebGLRenderTarget(
			typeof window !== 'undefined' ? window.innerWidth : 2000,
			typeof window !== 'undefined' ? window.innerHeight : 1000,
			{
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				type: FloatType,
				depthBuffer: false,
			}
		);

		this.lastSize = { width: 0, height: 0 };

		this.initNewCamera( camera );
		this.initNewSize( window.innerWidth, window.innerHeight );

		// TODO: move this to a getter / setter
		let weightTransform = 0;
		Object.defineProperty( this, 'weightTransform', {
			set( value ) {

				weightTransform = value;

				this.temporalResolvePass.fullscreenMaterial.defines.WEIGHT_TRANSFORM = ( 1 - value ).toFixed( 5 );
				this.temporalResolvePass.fullscreenMaterial.needsUpdate = true;

			},
			get() {

				return weightTransform;

			}
		} );

	}

	initNewCamera( camera ) {

		this.activeCamera = camera;

		this.temporalResolvePass = new TemporalResolvePass(
			this.ptRenderer,
			this.scene,
			camera
		);
		this.temporalResolvePass.fullscreenMaterial.samplesTexture = this.ptRenderer.target.texture;
		this.fullscreenMaterial.temporalResolveTexture = this.temporalResolvePass.renderTarget.texture;

	}

	initNewSize( width, height ) {

		this.lastSize.width = width;
		this.lastSize.height = height;

		this.renderTarget.setSize( width, height );
		this.temporalResolvePass.setSize( width, height );

	}

	update() {

		const renderer = this.ptRenderer._renderer;

		// save original values
		const origRenderTarget = renderer.getRenderTarget();

		this.ptRenderer.stableTiles = false;

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
		this.temporalResolvePass.fullscreenMaterial.samples =
			this.ptRenderer.samples;

		this.temporalResolvePass.fullscreenMaterial.temporalResolveMix =
			this.temporalResolveMix;

		this.temporalResolvePass.fullscreenMaterial.clampRadius =
			parseInt( this.clampRadius );

		this.temporalResolvePass.fullscreenMaterial.newSamplesSmoothing =
			this.newSamplesSmoothing;

		this.temporalResolvePass.fullscreenMaterial.newSamplesCorrection =
			this.newSamplesCorrection;

		this.temporalResolvePass.render( renderer );

		renderer.setRenderTarget( this.renderTarget );
		this.fsQuad.render( renderer );

		// restore original values
		renderer.setRenderTarget( origRenderTarget );

	}

}
