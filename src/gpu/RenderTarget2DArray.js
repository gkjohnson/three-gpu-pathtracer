import {
	DataTexture2DArray,
	WebGLRenderTarget,
	RGBAFormat,
	UnsignedByteType,
	MeshBasicMaterial,
	Color,
	RepeatWrapping,
	LinearFilter,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/pass.js';

const prevColor = new Color();
export class RenderTarget2DArray extends WebGLRenderTarget {

	constructor( ...args ) {

		super( ...args );

		const dataTexture = new DataTexture2DArray();
		dataTexture.format = RGBAFormat;
		dataTexture.type = UnsignedByteType;
		dataTexture.minFilter = LinearFilter;
		dataTexture.magFilter = LinearFilter;
		dataTexture.wrapS = RepeatWrapping;
		dataTexture.wrapT = RepeatWrapping;
		dataTexture.setTextures = ( ...args ) => {

			this.setTextures( ...args );

		};

		this.setTexture( dataTexture );

		const fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
		this.fsQuad = fsQuad;

	}

	setTextures( renderer, width, height, textures ) {

		// save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevColor );

		// resize the render target
		const depth = textures.length;
		this.setSize( width, height, depth );
		renderer.setClearColor( 0, 0 );

		// render each texture into each layer of the target
		const fsQuad = this.fsQuad;
		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
			fsQuad.material.map = texture;

			renderer.setRenderTarget( this, i );
			fsQuad.render( renderer );

		}

		// reset the renderer
		fsQuad.material.map = null;
		renderer.setClearColor( prevColor, prevAlpha );
		renderer.setRenderTarget( prevRenderTarget );

	}

	dispose() {

		super.dispose();
		this.fsQuad.dispose();

	}

}
