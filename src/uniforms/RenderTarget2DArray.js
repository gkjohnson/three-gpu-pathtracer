import {
	WebGLArrayRenderTarget,
	RGBAFormat,
	UnsignedByteType,
	Color,
	RepeatWrapping,
	LinearFilter,
	NoToneMapping,
	ShaderMaterial,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { reduceTexturesToUniqueSources } from './utils.js';

const prevColor = new Color();
export class RenderTarget2DArray extends WebGLArrayRenderTarget {

	constructor( width, height, depth, options ) {

		super( width, height, depth, {
			format: RGBAFormat,
			type: UnsignedByteType,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			wrapS: RepeatWrapping,
			wrapT: RepeatWrapping,
			...options,
		} );

		this.texture.setTextures = ( ...args ) => {

			this.setTextures( ...args );

		};

		const fsQuad = new FullScreenQuad( new CopyMaterial() );
		this.fsQuad = fsQuad;

	}

	setTextures( renderer, width, height, textures ) {

		// get the list of textures with unique sources
		const uniqueTextures = reduceTexturesToUniqueSources( textures );

		// save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;
		const prevAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevColor );

		// resize the render target and ensure we don't have an empty texture
		// render target depth must be >= 1 to avoid unbound texture error on android devices
		const depth = uniqueTextures.length || 1;
		this.setSize( width, height, depth );
		renderer.setClearColor( 0, 0 );
		renderer.toneMapping = NoToneMapping;

		// render each texture into each layer of the target
		const fsQuad = this.fsQuad;
		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = uniqueTextures[ i ];
			if ( texture ) {

				// revert to default texture transform before rendering
				texture.matrixAutoUpdate = false;
				texture.matrix.identity();

				fsQuad.material.map = texture;

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

class CopyMaterial extends ShaderMaterial {

	get map() {

		return this.uniforms.map.value;

	}
	set map( v ) {

		this.uniforms.map.value = v;

	}

	constructor() {

		super( {
			uniforms: {

				map: { value: null },

			},

			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,

			fragmentShader: /* glsl */`
				uniform sampler2D map;
				varying vec2 vUv;
				void main() {

					gl_FragColor = texture2D( map, vUv );

				}
			`
		} );

	}


}
