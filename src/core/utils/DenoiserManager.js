// Utils to interface with the denoiser

import { Denoiser } from 'denoiser';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ClampedInterpolationMaterial } from '../../materials/fullscreen/ClampedInterpolationMaterial';
import { BlendMaterial } from '../../materials/fullscreen/BlendMaterial';

import { NoBlending } from 'three';
import * as THREE from 'three';

export class DenoiserManager {

	constructor( renderer ) {

		this.renderer = renderer;
		this.denoiser = new Denoiser( 'webgl', renderer.domElement );
		this.denoiser.inputMode = 'webgl';
		this.denoiser.outputMode = 'webgl';
		this.denoiser.weightsUrl = 'https://cdn.jsdelivr.net/npm/denoiser/tzas';

		//this.denoiser.debugging = true;
		//this.denoiser.usePassThrough = true;
		//this.rawCanvas = document.getElementById( 'rawCanvas' );
		//this.denoiser.setCanvas( this.rawCanvas );

		this.isDenoising = false;
		this.fadeTime = 500;
		this.denoiserFinished = 0;

		// Same as pathtracer so tonemapping is the same
		this.ptMaterial = new ClampedInterpolationMaterial( {
			map: null,
			transparent: true,
			blending: NoBlending,

			premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		} );
		this.ptMaterial.opacity = 1;

		// Material to blend between pathtracer and denoiser
		// TODO: Not sure if  params are required
		this.blendMaterial = new BlendMaterial();

		this.quad = new FullScreenQuad( this.ptMaterial );
		this.createConversionRenderTarget( renderer.domElement.width, renderer.domElement.height );

	}

	async denoise( rawPathtracedTexture, albedoTexture, normalTexture ) {

		this.isDenoising = true;
		// Adjust the height /width if changed from before
		const height = this.renderer.domElement.height;
		const width = this.renderer.domElement.width;

		if ( this.denoiser.height !== height || this.denoiser.width !== width ) {

			this.denoiser.width = width;
			this.denoiser.height = height;
			this.createConversionRenderTarget( width, height );
			if ( this.rawCanvas ) {

				this.rawCanvas.width = width;
				this.rawCanvas.height = height;

			}

		}

		// set so we can access later when blending
		this.pathtracedTexture = this.getCorrectPathtracerTexture( rawPathtracedTexture );
		const colorWebGLTexture = this.getWebGLTexture( this.pathtracedTexture );
		const albedoWebGLTexture = this.getWebGLTexture( albedoTexture );
		const normalWebGLTexture = this.getWebGLTexture( normalTexture );

		//* run the denoiser
		this.renderer.resetState();

		/* The setting of inputs is async and running too quick before execute. this will be fixed in a future version
		see https://github.com/DennisSmolek/Denoiser/issues/21
		const denoisedWebGLTexture = await this.denoiser.execute( colorWebGLTexture, albedoWebGLTexture, normalWebGLTexture );
		*/

		// Set input Textures with await
		await this.denoiser.setInputTexture( 'color', colorWebGLTexture );
		if ( albedoTexture ) await this.denoiser.setInputTexture( 'albedo', albedoWebGLTexture );
		if ( normalTexture ) await this.denoiser.setInputTexture( 'normal', normalWebGLTexture );
		// Run the denoiser
		const denoisedWebGLTexture = await this.denoiser.execute();

		this.renderer.resetState();
		if ( ! this.outputTexture ) this.outputTexture = this.createOutputTexture();
		// inject the webGLTexture into the texture
		this.denoisedTexture = this.injectWebGLTexture( this.outputTexture, denoisedWebGLTexture );
		// mark as complete and setup the renderer
		this.isDenoising = false;
		this.denoiserFinished = performance.now();
		return this.denoisedTexture;

	}

	// render the blended output
	renderOutput( bypassTexture ) {

		if ( ! this.pathtracedTexture || ! this.denoisedTexture ) return;

		//const currentTarget = this.renderer.getRenderTarget();
		this.quad.material = this.blendMaterial;
		this.blendMaterial.target1 = this.pathtracedTexture;
		this.blendMaterial.target2 = this.denoisedTexture;
		this.blendMaterial.opacity = Math.min( ( performance.now() - this.denoiserFinished ) / this.fadeTime, 1 );

		// Lets us see the aux textures
		if ( bypassTexture ) {

			this.blendMaterial.target2 = bypassTexture;
			this.blendMaterial.opacity = 1;

		}

		// should we force to canvas or allow the user to set to their own target?
		//this.renderer.setRenderTarget( null );
		this.quad.render( this.renderer );
		//this.renderer.setRenderTarget( currentTarget );

	}

	// because of size issues we need to create one when we change size
	createConversionRenderTarget( width, height ) {

		// if one exists destroy it
		if ( this.conversionRenderTarget ) this.conversionRenderTarget.dispose();

		// todo Probably a better setting with dpr
		this.conversionRenderTarget = new THREE.WebGLRenderTarget( width, height );
		this.conversionRenderTarget.colorspace = THREE.SRGBColorSpace;

	}

	// The plain texture is raw without toneMapping this is more like what renders to canvas
	getCorrectPathtracerTexture( pathtracedTexture ) {

		const oldRenderTarget = this.renderer.getRenderTarget();
		this.quad.material = this.ptMaterial;
		this.ptMaterial.map = pathtracedTexture;
		this.renderer.setRenderTarget( this.conversionRenderTarget );
		this.quad.render( this.renderer );
		this.renderer.setRenderTarget( oldRenderTarget );
		return this.conversionRenderTarget.texture;

	}

	// create an output texture we can inject to
	createOutputTexture( input ) {

		/* thought this would work
		const texture = input.clone();
		// initialize the texture
		return this.initializeTexture( texture );
		*/
		// hardway
		const tempRT = new THREE.WebGLRenderTarget( this.denoiser.width, this.denoiser.height );
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
