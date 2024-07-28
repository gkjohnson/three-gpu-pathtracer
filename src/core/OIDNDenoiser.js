// Utils to interface with the denoiser

import { Denoiser } from 'denoiser';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ClampedInterpolationMaterial } from '../materials/fullscreen/ClampedInterpolationMaterial.js';

import { NoBlending, WebGLRenderTarget, SRGBColorSpace, MeshBasicMaterial } from 'three';

export class OIDNDenoiser {

	get quality() {

		return this.denoiser.quality;

	}

	set quality( v ) {

		this.denoiser.quality = v;
		if ( v === 'fast' && this.hdr ) this.hdr = false;
		//if ( v === 'balanced' && ! this.hdr ) this.hdr = true;

	}

	get useAux() {

		return this._useAux;

	}

	set useAux( v ) {

		this._useAux = v;
		this.denoiser.resetInputs();

	}

	get cleanAux() {

		return ! this.denoiser.dirtyAux;

	}

	set cleanAux( v ) {

		this.denoiser.dirtyAux = ! v;

	}

	get hdr() {

		return this.denoiser.hdr;

	}

	set hdr( v ) {

		this.denoiser.hdr = v;
		if ( v && this.quality === 'fast' ) this.quality = 'balanced';

	}

	get weightsUrl() {

		return this.denoiser.weightsUrl;

	}

	set weightsUrl( url ) {

		this.denoiser.weightsUrl = url;

	}

	//* Debugging
	get denoiserDebugging() {

		return this.denoiser.debugging;

	}

	set denoiserDebugging( v ) {

		this.denoiser.debugging = v;

	}

	constructor( renderer ) {

		this.renderer = renderer;
		this.denoiser = new Denoiser( 'webgl', renderer.domElement );
		this.denoiser.inputMode = 'webgl';
		this.denoiser.outputMode = 'webgl';
		this.denoiser.weightsUrl = 'https://cdn.jsdelivr.net/npm/denoiser/tzas';
		this.denoiser.onProgress( progress => this.handleProgress( progress ) );
		//this.denoiser.hdr = true;

		this.isDenoising = false;
		this.fadeTime = 500;
		this.denoiserFinished = 0;
		this.cleanAux = true;
		this._useAux = true;
		this.externalAux = false;
		this.auxTextures = { albedo: null, normal: null };
		this.progressListeners = new Set();

		// split props
		this.doSplit = false;
		this.splitPoint = 0.5;
		this.t2conversion = false;

		// Same as pathtracer so tonemapping is the same
		this.linearToSRGBMaterial = new MeshBasicMaterial( {
			map: null,
			transparent: true,
			blending: NoBlending,
		} );

		// Material to blend between pathtracer and denoiser
		this.blendToCanvasMaterial = new ClampedInterpolationMaterial( {
			map: null,
			transparent: true,
			premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		} );

		this.quad = new FullScreenQuad( this.linearToSRGBMaterial );
		this.createConversionRenderTarget( renderer.domElement.width, renderer.domElement.height );

	}

	setAuxTextures( albedoTexture, normalTexture ) {

		this.externalAux = true;
		this.auxTextures.albedo = albedoTexture;
		this.auxTextures.normal = normalTexture;

	}

	async denoise( rawPathtracedTexture, albedoTexture, normalTexture ) {

		this.isDenoising = true;

		// Adjust the height /width if changed from before
		const { width, height } = rawPathtracedTexture.image;
		if ( this.denoiser.height !== height || this.denoiser.width !== width ) {

			this.denoiser.width = width;
			this.denoiser.height = height;
			this.createConversionRenderTarget( width, height );

		}

		// Extract the raw webGLTextures
		const colorWebGLTexture = this.getWebGLTexture( this.getLinearToSRGBTexture( rawPathtracedTexture, this.conversionRenderTarget ) );
		const albedoWebGLTexture = this.getWebGLTexture( albedoTexture );
		const normalWebGLTexture = this.getWebGLTexture( normalTexture );

		//* run the denoiser ----------------------------
		this.renderer.resetState();

		// Run the denoiser
		const denoisedWebGLTexture = await this.denoiser.execute( colorWebGLTexture, albedoWebGLTexture, normalWebGLTexture );

		this.renderer.resetState();
		if ( ! this.outputTexture ) this.outputTexture = this.createOutputTexture();
		// inject the webGLTexture into the texture
		this.denoisedTexture = this.injectWebGLTexture( this.outputTexture, denoisedWebGLTexture );
		// mark as complete and setup the renderer
		this.isDenoising = false;
		// we use this for the fade in
		this.denoiserFinished = performance.now();
		this.handleProgress( 1 );
		return this.denoisedTexture;

	}

	// render the blended output
	renderOutput( bypassTextureName ) {

		const bypassTexture = this.auxTextures[ bypassTextureName ];

		if ( ! this.denoisedTexture ) return;

		this.quad.material = this.blendToCanvasMaterial;
		this.blendToCanvasMaterial.map = this.denoisedTexture;
		this.blendToCanvasMaterial.opacity = Math.min( ( performance.now() - this.denoiserFinished ) / this.fadeTime, 1 );

		// Lets us see the aux textures
		if ( bypassTexture ) {

			this.blendToCanvasMaterial.map = bypassTexture;
			this.blendToCanvasMaterial.opacity = 1;

		}

		const currentAutoClear = this.renderer.autoClear;
		this.renderer.autoClear = false;
		this.quad.render( this.renderer );
		this.renderer.autoClear = currentAutoClear;

	}

	// because of size issues we need to create one when we change size
	createConversionRenderTarget( width, height ) {

		// if one exists destroy it
		if ( this.conversionRenderTarget ) this.conversionRenderTarget.dispose();

		// todo Probably a better setting with dpr
		this.conversionRenderTarget = new WebGLRenderTarget( width, height );
		this.conversionRenderTarget.colorspace = SRGBColorSpace;
		this.conversionRenderTarget.texture.colorspace = SRGBColorSpace;

	}

	// The plain texture is raw without toneMapping this is more like what renders to canvas
	getLinearToSRGBTexture( pathtracedTexture, target ) {

		const oldRenderTarget = this.renderer.getRenderTarget();
		this.quad.material = this.linearToSRGBMaterial;
		this.linearToSRGBMaterial.map = pathtracedTexture;
		this.renderer.setRenderTarget( target );
		this.quad.render( this.renderer );
		this.renderer.setRenderTarget( oldRenderTarget );
		return target.texture;

	}

	// create an output texture we can inject to
	createOutputTexture() {

		const tempRT = new WebGLRenderTarget( this.denoiser.width, this.denoiser.height );
		// render the quad to the texture
		const oldRenderTarget = this.renderer.getRenderTarget();
		this.renderer.setRenderTarget( tempRT );
		this.quad.render( this.renderer );
		this.renderer.setRenderTarget( oldRenderTarget );

		// get the texture out of the tempRT
		const texture = tempRT.texture;
		// dispose?
		return texture;

	}

	abort() {

		this.denoiser.abort();
		this.handleProgress( 0 );

	}

	//* Listeners

	handleProgress( progress ) {

		let outProgress = progress * 100;
		// we only return 100 when isDenoised is true but the denoiser progress is for tiling
		if ( this.isDenoising && outProgress >= 1 ) outProgress --;
		this.progressListeners.forEach(listener => listener(outProgress));

	}

	onProgress( listener ) {

		this.progressListeners.add( listener );
		return () => this.progressListeners.delete( listener );

	}


	//* Utils ----------------------------
	// get the webGLTexture out of a renderTarget or THREE.texture
	getWebGLTexture( input ) {

		if ( ! input ) return null;
		const baseTexture = input.isTexture ? input : ( input ).texture;
		const textureProps = this.renderer.properties.get( baseTexture );
		return textureProps.__webglTexture;

	}

	//put the raw WebGLTexture into a THREE.texture
	injectWebGLTexture( texture, webGLTexture ) {

		// get the webGLTexture original from the texture
		const textureProps = this.renderer.properties.get( texture );
		textureProps.__webglTexture = webGLTexture;
		return texture;

	}

	// Initialize a texture in the renderer (trying to not need warm start)
	initializeTexture( texture ) {

		this.renderer.initTexture( texture );

	}

}
