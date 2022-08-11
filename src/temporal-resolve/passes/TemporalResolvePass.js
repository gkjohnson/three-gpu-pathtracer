import {
	Color,
	FloatType,
	FramebufferTexture, LinearFilter,
	MeshDepthMaterial,
	NearestFilter,
	RGBADepthPacking,
	RGBAFormat,
	Vector2,
	WebGLRenderTarget
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { TemporalResolveMaterial } from '../materials/TemporalResolveMaterial.js';
import { VelocityPass } from './VelocityPass.js';

const zeroVec2 = new Vector2();
const meshDepthMaterial = new MeshDepthMaterial( {
	depthPacking: RGBADepthPacking,
} );
const blackColor = new Color( 0 );

export class TemporalResolvePass {

	constructor( ptRenderer, scene, camera ) {

		this.ptRenderer = ptRenderer;
		this.scene = scene;
		this.camera = camera;

		this.renderTarget = new WebGLRenderTarget( 1, 1, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: FloatType,
			depthBuffer: false,
		} );

		this.depthRenderTarget = new WebGLRenderTarget( 1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
		} );

		this.velocityPass = new VelocityPass( scene, camera );

		this.fullscreenMaterial = new TemporalResolveMaterial();

		this.fullscreenMaterial.velocityTexture = this.velocityPass.renderTarget.texture;
		this.fullscreenMaterial.depthTexture = this.depthRenderTarget.texture;

		this.fsQuad = new FullScreenQuad( null );
		this.fsQuad.material = this.fullscreenMaterial;

		this.setSize( window.innerWidth, window.innerHeight );

	}

	dispose() {

		this.renderTarget.dispose();
		this.accumulatedSamplesTexture.dispose();
		this.lastDepthTexture.dispose();
		this.fullscreenMaterial.dispose();

	}

	setSize( width, height ) {

		this.renderTarget.setSize( width, height );
		this.depthRenderTarget.setSize( width, height );
		this.velocityPass.setSize( width, height );

		this.createFramebuffers( width, height );

	}

	createFramebuffers( width, height ) {

		if ( this.accumulatedSamplesTexture )
			this.accumulatedSamplesTexture.dispose();
		if ( this.lastDepthTexture ) this.lastDepthTexture.dispose();

		this.accumulatedSamplesTexture = new FramebufferTexture(
			width,
			height,
			RGBAFormat
		);
		this.accumulatedSamplesTexture.minFilter = LinearFilter;
		this.accumulatedSamplesTexture.magFilter = LinearFilter;
		this.accumulatedSamplesTexture.type = FloatType;

		this.lastDepthTexture = new FramebufferTexture( width, height, RGBAFormat );
		this.lastDepthTexture.minFilter = NearestFilter;
		this.lastDepthTexture.magFilter = NearestFilter;

		this.fullscreenMaterial.accumulatedSamplesTexture = this.accumulatedSamplesTexture;
		this.fullscreenMaterial.lastDepthTexture = this.lastDepthTexture;

		this.fullscreenMaterial.needsUpdate = true;

	}

	render( renderer ) {

		// render depth
		this.scene.overrideMaterial = meshDepthMaterial;
		renderer.setRenderTarget( this.depthRenderTarget );
		renderer.clear();

		const { background } = this.scene;
		this.scene.background = blackColor;

		renderer.render( this.scene, this.camera );

		this.scene.background = background;
		this.scene.overrideMaterial = null;

		// render velocity
		this.velocityPass.render( renderer );

		// update uniforms of this pass
		this.fullscreenMaterial.tileCount = this.ptRenderer.tiles.x * this.ptRenderer.tiles.y;
		this.fullscreenMaterial.curInverseProjectionMatrix.copy(
			this.camera.projectionMatrixInverse
		);
		this.fullscreenMaterial.curCameraMatrixWorld.copy(
			this.camera.matrixWorld
		);
		this.fullscreenMaterial.cameraNear = this.camera.near;
		this.fullscreenMaterial.cameraFar = this.camera.far;

		// now render this fullscreen pass
		renderer.setRenderTarget( this.renderTarget );
		this.fsQuad.render( renderer );

		// save all buffers for use in the next frame
		renderer.copyFramebufferToTexture( zeroVec2, this.accumulatedSamplesTexture );

		renderer.setRenderTarget( this.depthRenderTarget );
		renderer.copyFramebufferToTexture( zeroVec2, this.lastDepthTexture );

		this.fullscreenMaterial.prevInverseProjectionMatrix.copy(
			this.camera.projectionMatrixInverse
		);
		this.fullscreenMaterial.prevCameraMatrixWorld.copy(
			this.camera.matrixWorld
		);

		renderer.setRenderTarget( null );

	}

}
