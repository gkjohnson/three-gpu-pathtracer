import {
	RenderTarget,
	RGBAFormat,
	UnsignedByteType,
	RepeatWrapping,
	LinearFilter,
	NoToneMapping,
	QuadMesh,
} from 'three/webgpu';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial';

function getTextureHash( texture ) {

	return texture ? `${ texture.uuid }:${ texture.version }` : null;

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
		this.hashes = [ null ];
		this.quadMesh = new QuadMesh( new RenderToScreenNodeMaterial() );

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

		if ( renderer.initialized ) {

			this._renderTextures( renderer, this.textures );

		}

	}

	_renderTextures( renderer, textures ) {

		// Save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;

		renderer.toneMapping = NoToneMapping;

		// Render each texture into each layer of the target
		const quadMesh = this.quadMesh;
		const hashes = this.hashes;
		const depth = this.textures.length;

		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
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
