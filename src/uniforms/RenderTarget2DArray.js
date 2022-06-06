import {
	WebGLArrayRenderTarget,
	RGBAFormat,
	UnsignedByteType,
	MeshBasicMaterial,
	Color,
	RepeatWrapping,
	LinearFilter,
	NoToneMapping,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const prevColor = new Color();
export class RenderTarget2DArray extends WebGLArrayRenderTarget {

	constructor( ...args ) {

		super( ...args );

		const tex = this.texture;
		tex.format = RGBAFormat;
		tex.type = UnsignedByteType;
		tex.minFilter = LinearFilter;
		tex.magFilter = LinearFilter;
		tex.wrapS = RepeatWrapping;
		tex.wrapT = RepeatWrapping;
		tex.setTextures = ( ...args ) => {

			this.setTextures( ...args );

		};

		const fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
		this.fsQuad = fsQuad;

	}

	setTextures( renderer, width, height, textures ) {

		// save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;
		const prevAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevColor );

		// resize the render target and ensure we don't have an empty texture
		// render target depth must be >= 1 to avoid unbound texture error on android devices
		const depth = textures.length || 1;
		this.setSize( width, height, depth );
		renderer.setClearColor( 0, 0 );
		renderer.toneMapping = NoToneMapping;

		// render each texture into each layer of the target
		const fsQuad = this.fsQuad;
		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
			if ( texture ) {

				// revert to default texture transform before rendering
				texture.matrixAutoUpdate = false;
				texture.matrix.identity();

				fsQuad.material.map = texture;
				fsQuad.material.transparent = true;

				renderer.setRenderTarget( this, i );
				fsQuad.render( renderer );

				// restore custom texture transform
				texture.updateMatrix();
				texture.matrixAutoUpdate = true;

			}

		}

		// reset the renderer
		fsQuad.material.map = null;
		renderer.setClearColor( prevColor, prevAlpha );
		renderer.setRenderTarget( prevRenderTarget );
		renderer.toneMapping = prevToneMapping;

	}

	dispose() {

		super.dispose();
		this.fsQuad.dispose();

	}

}
