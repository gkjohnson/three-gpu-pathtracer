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

				envMap: { value: null },
				flipEnvMap: { value: - 1 },

			},

			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

			fragmentShader: /* glsl */`
				#define ENVMAP_TYPE_CUBE_UV

				uniform samplerCube envMap;
				uniform float flipEnvMap;
				varying vec2 vUv;

				#include <common>
				#include <cube_uv_reflection_fragment>

				${ CommonGLSL.util_functions }

				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					rayDirection.x *= flipEnvMap;
					gl_FragColor = textureCube( envMap, rayDirection );

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

	generate( source, width = null, height = null ) {

		if ( ! source.isCubeTexture ) {

			throw new Error( 'CubeToEquirectMaterial: Source can only be cube textures.' );

		}

		const image = source.images[ 0 ];
		const renderer = this._renderer;
		const quad = this._quad;

		// determine the dimensions if not provided
		if ( width === null ) {

			width = 4 * image.height;

		}

		if ( height === null ) {

			height = 2 * image.height;

		}

		const target = new WebGLRenderTarget( width, height, {
			type: FloatType,
			colorSpace: image.colorSpace,
		} );

		// prep the cube map data
		const imageHeight = image.height;
		const maxMip = Math.log2( imageHeight ) - 2;
		const texelHeight = 1.0 / imageHeight;
		const texelWidth = 1.0 / ( 3 * Math.max( Math.pow( 2, maxMip ), 7 * 16 ) );

		quad.material.defines.CUBEUV_MAX_MIP = `${ maxMip }.0`;
		quad.material.defines.CUBEUV_TEXEL_WIDTH = texelWidth;
		quad.material.defines.CUBEUV_TEXEL_HEIGHT = texelHeight;
		quad.material.uniforms.envMap.value = source;
		quad.material.uniforms.flipEnvMap.value = source.isRenderTargetTexture ? 1 : - 1;
		quad.material.needsUpdate = true;

		// save state and render the contents
		const currentTarget = renderer.getRenderTarget();
		const currentAutoClear = renderer.autoClear;
		renderer.autoClear = true;
		renderer.setRenderTarget( target );
		quad.render( renderer );
		renderer.setRenderTarget( currentTarget );
		renderer.autoClear = currentAutoClear;

		// read the data back
		const buffer = new Uint16Array( width * height * 4 );
		const readBuffer = new Float32Array( width * height * 4 );
		renderer.readRenderTargetPixels( target, 0, 0, width, height, readBuffer );
		target.dispose();

		for ( let i = 0, l = readBuffer.length; i < l; i ++ ) {

			buffer[ i ] = DataUtils.toHalfFloat( readBuffer[ i ] );

		}

		// produce the data texture
		const result = new DataTexture( buffer, width, height, RGBAFormat, HalfFloatType );
		result.minFilter = LinearMipMapLinearFilter;
		result.magFilter = LinearFilter;
		result.wrapS = RepeatWrapping;
		result.wrapT = RepeatWrapping;
		result.mapping = EquirectangularReflectionMapping;
		result.needsUpdate = true;

		return result;

	}

	dispose() {

		this._quad.dispose();

	}

}
