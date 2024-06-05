import {
	DataTexture,
	DataUtils,
	EquirectangularReflectionMapping,
	FloatType,
	HalfFloatType,
	LinearFilter,
	LinearMipMapLinearFilter,
	RGBAFormat,
	RepeatWrapping,
	ShaderMaterial,
	WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import * as CommonGLSL from '../shader/common/index.js';

class CubeToEquirectMaterial extends ShaderMaterial {

	constructor() {

		super( {

			uniforms: {

				cubeMap: { value: null },

			},

			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

			fragmentShader: /* glsl */`
				#define ENVMAP_TYPE_CUBE_UV

				uniform sampler2D cubeMap;
				varying vec2 vUv;

				#include <common>
				#include <cube_uv_reflection_fragment>

				${ CommonGLSL.util_functions }

				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					gl_FragColor = textureCubeUV( cubeMap, rayDirection, 0.0 );

				}`
		} );

		this.depthWrite = false;
		this.depthTest = false;

	}

}

export class CubeToEquirectGenerator {

	constructor( renderer ) {

		this._renderer = renderer;
		this._quad = new FullScreenQuad( new CubeToEquirectMaterial() );

	}

	generate( source, width, height ) {

		if ( ! source.isCubeTexture ) {

			throw new Error( 'CubeToEquirectMaterial: Source can only be cube textures.' );

		}

		// set up the conents
		const target = new WebGLRenderTarget( width, height, {
			type: FloatType,
			colorSpace: source.image[ 0 ].colorSpace,
		} );
		const renderer = this._renderer;
		const quad = this._quad;
		const currentTarget = renderer.getRenderTarget();
		const currentAutoClear = renderer.autoClear;

		// render the contents
		renderer.autoClear = true;
		renderer.setRenderTarget( target );
		quad.render( renderer );
		renderer.setRenderTarget( currentTarget );
		renderer.autoClear = currentAutoClear;

		// read the data back
		const buffer = new Uint16Array( width * height * 4 );
		const readBuffer = new Float32Array( width * height * 4 );
		renderer.readRenderTargetPixels( target, 0, 0, width, height, readBuffer );

		for ( let i = 0, l = readBuffer.length; i < l; i ++ ) {

			buffer[ i ] = DataUtils.toHalfFloat( readBuffer[ i ] );

		}

		const result = new DataTexture( buffer, width, height, RGBAFormat, HalfFloatType );
		result.minFilter = LinearMipMapLinearFilter;
		result.magFilter = LinearFilter;
		result.wrapS = RepeatWrapping;
		result.wrapT = RepeatWrapping;
		result.mapping = EquirectangularReflectionMapping;
		result.needsUpdate = true;

		target.dispose();

		return result;

	}

	dispose() {

		this._quad.dispose();

	}

}
