import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Algorithm: https://www.artstation.com/blogs/se_carri/XOBq/the-god-of-war-texture-optimization-algorithm-mip-flooding
export class MipFlooder {

	constructor( renderer ) {

		this._renderer = renderer;
		this._createShaders();

	}

	_createShaders() {

		this._downsampleShader = new THREE.ShaderMaterial( {
			uniforms: {
				tDiffuse: { value: null },
				convertToSRGB: { value: false },
				mipLevel: { value: 0 }
			},
			vertexShader: `
								varying vec2 vUv;
								void main() {
										vUv = uv;
										gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
								}
						`,
			fragmentShader: `
								precision highp sampler2D;
								uniform sampler2D tDiffuse;
								uniform bool convertToSRGB;
								uniform int mipLevel;
								varying vec2 vUv;

								void main() {
										vec4 texel = texture2D(tDiffuse, vUv);
										gl_FragColor = texel;
								}
						`
		} );

		this._compositeShader = new THREE.ShaderMaterial( {
			uniforms: {
				tLower: { value: null },
				tHigher: { value: null }
			},
			vertexShader: `
								varying vec2 vUv;
								void main() {
										vUv = uv;
										gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
								}
						`,
			fragmentShader: `
								precision highp sampler2D;
								uniform sampler2D tLower;
								uniform sampler2D tHigher;
								varying vec2 vUv;

								void main() {
										vec4 lowerColor = texture2D(tLower, vUv);
										vec4 higherColor = texture2D(tHigher, vUv);

										gl_FragColor.rgba = higherColor.a * higherColor.rgba + (1.0 - higherColor.a) * lowerColor.rgba;

								}
						`
		} );

	}

	floodFill( texture, renderTarget ) {

		const fsQuad = new FullScreenQuad();
		const { _renderer: renderer, _downsampleShader: downsampleShader, _compositeShader: compositeShader } = this;

		const clearColor = new THREE.Color();

		renderer.getClearColor( clearColor );
		renderer.setClearColor( 0x000000, 0 );
		const originalRenderTarget = renderer.getRenderTarget();

		// Create render targets
		const mipLevels = Math.log2( Math.max( texture.image.width, texture.image.height ) );
		const renderTargets = [];
		for ( let i = 0; i <= mipLevels; i ++ ) {

			const size = Math.pow( 2, mipLevels - i );
			renderTargets.push( new THREE.WebGLRenderTarget( size, size, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.FloatType,
				colorSpace: texture.colorSpace
			} ) );

		}

		// Downscale pass
		downsampleShader.uniforms.tDiffuse.value = texture;

		for ( let i = 0; i < renderTargets.length; i ++ ) {

			renderer.setRenderTarget( renderTargets[ i ] );

			fsQuad.material = downsampleShader;
			fsQuad.render( renderer );

			renderer.setRenderTarget( null );

		}

		// Create two additional render targets for the composite pass
		const compositeTargets = [
			new THREE.WebGLRenderTarget( texture.image.width, texture.image.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.FloatType
			} ),
			new THREE.WebGLRenderTarget( texture.image.width, texture.image.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.FloatType
			} )
		];

		let sourceIndex = 0;
		let targetIndex = 1;

		// Initial composite from the smallest mip level
		compositeShader.uniforms.tLower.value = renderTargets[ renderTargets.length - 1 ].texture;
		compositeShader.uniforms.tHigher.value = renderTargets[ renderTargets.length - 2 ].texture;
		renderer.setRenderTarget( compositeTargets[ targetIndex ] );
		fsQuad.material = compositeShader;
		fsQuad.render( renderer );

		// Continue compositing for the rest of the mip levels
		for ( let i = renderTargets.length - 2; i >= 0; i -- ) {

			const t = sourceIndex;
			sourceIndex = targetIndex;
			targetIndex = t;

			compositeShader.uniforms.tLower.value = compositeTargets[ sourceIndex ].texture;
			compositeShader.uniforms.tHigher.value = renderTargets[ i ].texture;
			renderer.setRenderTarget( i === 0 ? renderTarget : compositeTargets[ targetIndex ] );
			fsQuad.render( renderer );

		}


		renderer.setClearColor( clearColor );
		renderer.setRenderTarget( originalRenderTarget );

		const finalTexture = compositeTargets[ targetIndex ].texture;

		for ( let i = 0; i < renderTargets.length; i ++ ) {

			renderTargets[ i ].dispose();

		}

		for ( let i = 0; i < compositeTargets.length; i ++ ) {

			compositeTargets[ i ].dispose();

		}

		fsQuad.dispose();

		return finalTexture;

	}

	dispose() {

		this._downsampleShader.dispose();
		this._compositeShader.dispose();

	}

}
