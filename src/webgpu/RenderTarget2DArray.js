import {
	MeshBasicMaterial,
	RenderTarget,
	RGBAFormat,
	UnsignedByteType,
	ClampToEdgeWrapping,
	LinearFilter,
	NoToneMapping,
	QuadMesh,
	NoBlending,
	MeshBasicMaterial,
} from 'three/webgpu';

function getTextureHash( texture ) {

	return `${ texture.source.uuid }:${ texture.source.version }`;

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
			wrapS: ClampToEdgeWrapping,
			wrapT: ClampToEdgeWrapping,
			generateMipmaps: false,
			...options,
		};

		this.renderTarget = new RenderTarget( width, height, {
			multiview: true,
			depthBuffer: false,
			depth: 1,
			format: textureOptions.format,
			type: textureOptions.type,
			minFilter: textureOptions.minFilter,
			magFilter: textureOptions.magFilter,
			wrapS: textureOptions.wrapS,
			wrapT: textureOptions.wrapT,
			generateMipmaps: textureOptions.generateMipmaps,
		} );
		this.texture.isArrayTexture = true;

		this.hashes = [];
		this.quadMesh = new QuadMesh( new MeshBasicMaterial() );
		this.quadMesh.material.blending = NoBlending;

	}

	setSize( width, height ) {

		this.renderTarget.setSize( width, height, this.renderTarget.depth );
		this.hashes.fill( null );

	}

	setTextures( renderer, textures ) {

		const depth = textures.length || 1;
		this.renderTarget.setSize( this.width, this.height, depth );
		this.texture.isArrayTexture = true;

		this.hashes.length = this.renderTarget.depth;

		if ( textures.length > 0 ) {

			this._renderTextures( renderer, textures );

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
		const depth = textures.length;

		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
			const hash = getTextureHash( texture );
			if ( hashes[ i ] !== hash ) {

				// Revert to default texture transform before rendering
				texture.matrixAutoUpdate = false;
				texture.matrix.identity();

				quadMesh.material.map = texture;

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
