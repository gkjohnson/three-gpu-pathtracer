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

export class RenderTarget2DArrayWebGPU {

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

		this._width = width;
		this._height = height;
		this._depth = 1;

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

		this.hashes = [ null ];

		this._quadMesh = new QuadMesh( new RenderToScreenNodeMaterial() );

		this._pendingTextures = null;
		this._pendingWidth = null;
		this._pendingHeight = null;

	}

	get width() {

		return this._width;

	}

	get height() {

		return this._height;

	}

	get depth() {

		return this._depth;

	}

	get texture() {

		return this.renderTarget.texture;

	}

	setSize( width, height, depth ) {

		this._width = width;
		this._height = height;
		this._depth = Math.max( depth, 2 );

		// Dispose old render target
		this.renderTarget.dispose();

		// Create new render target with updated size
		const oldTexture = this.texture;
		this.renderTarget = new RenderTarget( width, height, {
			multiview: true,
			depthBuffer: false,
			depth: depth,
			format: oldTexture.format,
			type: oldTexture.type,
			minFilter: oldTexture.minFilter,
			magFilter: oldTexture.magFilter,
			wrapS: oldTexture.wrapS,
			wrapT: oldTexture.wrapT,
			generateMipmaps: oldTexture.generateMipmaps,
		} );

		this.hashes = new Array( depth ).fill( null );

	}

	setTextures( renderer, textures, width = this._width, height = this._height ) {

		// If renderer is not initialized, defer the operation
		if ( ! renderer._initialized ) {

			this._pendingTextures = textures;
			this._pendingWidth = width;
			this._pendingHeight = height;
			return;

		}

		this._renderTextures( renderer, textures, width, height );
		this._pendingTextures = null;
		this._pendingWidth = null;
		this._pendingHeight = null;

	}

	update( renderer ) {

		if ( this._pendingTextures ) {

			this._renderTextures( renderer, this._pendingTextures, this._pendingWidth, this._pendingHeight );
			this._pendingTextures = null;
			this._pendingWidth = null;
			this._pendingHeight = null;

		}

	}


	_renderTextures( renderer, textures, width, height ) {

		// Save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;

		// Resize the render target and ensure we don't have an empty texture
		// Render target depth must be >= 1 to avoid unbound texture error on android devices
		const depth = textures.length || 1;
		if ( width !== this._width || height !== this._height || this._depth !== depth ) {

			this.setSize( width, height, depth );

		}

		renderer.toneMapping = NoToneMapping;

		// Render each texture into each layer of the target
		const quadMesh = this._quadMesh;
		const hashes = this.hashes;

		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
			const hash = getTextureHash( texture );
			if ( texture && ( hashes[ i ] !== hash || texture.isWebGLRenderTarget ) ) {

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
		this._quadMesh.material.dispose();

	}

}
