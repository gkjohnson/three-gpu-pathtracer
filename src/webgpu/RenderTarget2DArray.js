import {
	RenderTarget,
	RGBAFormat,
	UnsignedByteType,
	RepeatWrapping,
	LinearFilter,
	NoToneMapping,
	QuadMesh,
	NoBlending,
} from 'three/webgpu';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';

function getTextureHash( texture ) {

	return texture && texture.source ? `${ texture.source.uuid }:${ texture.source.version }` : null;

}

export class RenderTarget2DArray {

	get width() {

		return this.renderTarget.width;

	}

	get height() {

		return this.renderTarget.height;

	}

	get texture() {

		return this.renderTarget.texture;

	}

	constructor( width, height, options = {} ) {

		const textureOptions = {
			format: RGBAFormat,
			type: UnsignedByteType,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			wrapS: RepeatWrapping,
			wrapT: RepeatWrapping,
			generateMipmaps: false,
			...options,
		};

		this.renderTarget = new RenderTarget( width, height, {
			multiview: true,
			depthBuffer: false,
			depth: 2,
			format: textureOptions.format,
			type: textureOptions.type,
			minFilter: textureOptions.minFilter,
			magFilter: textureOptions.magFilter,
			wrapS: textureOptions.wrapS,
			wrapT: textureOptions.wrapT,
			generateMipmaps: textureOptions.generateMipmaps,
		} );
		this.texture.isArrayTexture = true;

		this.textures = [];
		this.hashes = [];
		this.quadMesh = new QuadMesh( new RenderToScreenNodeMaterial() );
		this.quadMesh.material.blending = NoBlending;

	}

	setSize( width, height ) {

		this.renderTarget.setSize( width, height, this.renderTarget.depth );
		this.hashes.fill( null );

	}

	setTextures( textures ) {

		this.textures = textures;
		const depth = textures.length || 1;
		this.renderTarget.setSize( this.width, this.height, depth );
		this.texture.isArrayTexture = true;

		this.hashes.length = this.renderTarget.depth;

	}

	update( renderer ) {

		if ( this.textures.length > 0 && renderer.initialized ) {

			this._renderTextures( renderer, this.textures );
			this.textures.length = 0;

		}

	}

	_renderTextures( renderer ) {

		// Save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;

		renderer.toneMapping = NoToneMapping;

		// Render each texture into each layer of the target
		const quadMesh = this.quadMesh;
		const hashes = this.hashes;
		const depth = this.textures.length;

		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = this.textures[ i ];
			const hash = getTextureHash( texture );
			if ( texture && ( hashes[ i ] !== hash || texture.isRenderTarget ) ) {

				// Revert to default texture transform before rendering
				texture.matrixAutoUpdate = false;
				texture.matrix.identity();

				quadMesh.material.texture = texture;

				renderer.setRenderTarget( this.renderTarget, i );
				quadMesh.render( renderer );

				// Restore custom texture transform
				texture.updateMatrix();
				texture.matrixAutoUpdate = true;

				// Ensure textures are not updated unnecessarily
				hashes[ i ] = hash;

			}

		}

		// Reset the renderer
		quadMesh.material.map = null;
		renderer.setRenderTarget( prevRenderTarget );
		renderer.toneMapping = prevToneMapping;

	}

	dispose() {

		this.renderTarget.dispose();
		this.quadMesh.material.dispose();

	}

}
