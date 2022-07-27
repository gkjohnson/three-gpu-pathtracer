import {
	ClampToEdgeWrapping,
	Color,
	FloatType,
	LinearFilter,
	MeshBasicMaterial,
	NoToneMapping,
	RGBAFormat,
	WebGLArrayRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { IESLoader } from '../utils/IESLoader.js';

const prevColor = new Color();
export class IESProfilesTexture extends WebGLArrayRenderTarget {

	constructor( ...args ) {

		super( ...args );

		const tex = this.texture;
		tex.format = RGBAFormat;
		tex.type = FloatType;
		tex.minFilter = LinearFilter;
		tex.magFilter = LinearFilter;
		tex.wrapS = ClampToEdgeWrapping;
		tex.wrapT = ClampToEdgeWrapping;
		tex.generateMipmaps = false;

		tex.updateFrom = ( ...args ) => {

			this.updateFrom( ...args );

		};

		const fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
		this.fsQuad = fsQuad;

		this.iesLoader = new IESLoader();

	}

	async updateFrom( renderer, textures ) {

		// save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;
		const prevAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevColor );

		// resize the render target and ensure we don't have an empty texture
		// render target depth must be >= 1 to avoid unbound texture error on android devices
		const depth = textures.length || 1;
		this.setSize( 360, 180, depth );
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

		fsQuad.dispose();

	}

	dispose() {

		super.dispose();
		this.fsQuad.dispose();

	}

}
