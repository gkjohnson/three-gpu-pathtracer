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

const prevColor = new Color();
function getTextureHash( texture ) {

	return texture ? `${ texture.uuid }:${ texture.version }` : null;

}

function assignOptions( target, options ) {

	for ( const key in options ) {

		if ( key in target ) {

			target[ key ] = options[ key ];

		}

	}

}

export class RenderTarget2DArray extends WebGLArrayRenderTarget {

	constructor( width, height, options ) {

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

		super( width, height, 1, textureOptions );

		// manually assign the options because passing options into the
		// constructor does not work
		assignOptions( this.texture, textureOptions );

		this.texture.setTextures = ( ...args ) => {

			this.setTextures( ...args );

		};

		this.hashes = [ null ];

		const fsQuad = new FullScreenQuad( new CopyMaterial() );
		this.fsQuad = fsQuad;

	}

	setTextures( renderer, textures, width = this.width, height = this.height ) {

		// save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;
		const prevAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevColor );

		// resize the render target and ensure we don't have an empty texture
		// render target depth must be >= 1 to avoid unbound texture error on android devices
		const depth = textures.length || 1;
		if ( width !== this.width || height !== this.height || this.depth !== depth ) {

			this.setSize( width, height, depth );
			this.hashes = new Array( depth ).fill( null );

		}

		renderer.setClearColor( 0, 0 );
		renderer.toneMapping = NoToneMapping;

		// render each texture into each layer of the target
		const fsQuad = this.fsQuad;
		const hashes = this.hashes;
		let updated = false;
		for ( let i = 0, l = depth; i < l; i ++ ) {

			const texture = textures[ i ];
			const hash = getTextureHash( texture );
			if ( texture && ( hashes[ i ] !== hash || texture.isWebGLRenderTarget ) ) {

				// revert to default texture transform before rendering
				texture.matrixAutoUpdate = false;
				texture.matrix.identity();

				fsQuad.material.map = texture;

				renderer.setRenderTarget( this, i );
				fsQuad.render( renderer );

				// restore custom texture transform
				texture.updateMatrix();
				texture.matrixAutoUpdate = true;

				// ensure textures are not updated unnecessarily
				hashes[ i ] = hash;
				updated = true;

			}

		}

		// reset the renderer
		fsQuad.material.map = null;
		renderer.setClearColor( prevColor, prevAlpha );
		renderer.setRenderTarget( prevRenderTarget );
		renderer.toneMapping = prevToneMapping;

		return updated;

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
