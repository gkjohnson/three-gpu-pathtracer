import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Given a UV map, extends the edges of islands by a specified number of pixels to avoid seams.
export class UVEdgeExpander {

	constructor( renderer ) {

		this._renderer = renderer;

		this._shader = new THREE.ShaderMaterial( {
			uniforms: {
				inputTexture: { value: null },
				texelSize: { value: new THREE.Vector2() }
			},
			vertexShader: `
				varying vec2 vUv;
				void main() {
						vUv = uv;
						gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
						`,
			fragmentShader: `
				uniform sampler2D inputTexture;
				uniform vec2 texelSize;

				float rgbSum(vec3 color) {
						return color.r + color.g + color.b;
				}

				void main() {
						vec2 uv = gl_FragCoord.xy * texelSize;
						vec4 center = texture2D(inputTexture, uv);

						// If the center pixel is already opaque, keep it as is
						if (center.a > 0.0) {
								gl_FragColor = center;
								return;
						}

						gl_FragColor.a = 1.0;

						// Check neighboring pixels
						vec4 left = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(-1, 0), 0);
						vec4 right = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(1, 0), 0);
						vec4 top = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(0, 1), 0);
						vec4 bottom = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(0, -1), 0);

						vec4 topLeft = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(-1, 1), 0);
						vec4 topRight = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(1, 1), 0);
						vec4 bottomLeft = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(-1, -1), 0);
						vec4 bottomRight = texelFetch(inputTexture, ivec2(gl_FragCoord.xy) + ivec2(1, -1), 0);

						// Find the maximum alpha value among neighbors
						float maxAlpha = max(max(max(left.a, right.a), max(top.a, bottom.a)),
																 max(max(topLeft.a, topRight.a), max(bottomLeft.a, bottomRight.a)));

						// If we have an opaque neighbor, choose the color with the highest alpha and RGB sum
						if (maxAlpha > 0.0) {
								vec4 result = vec4(0.0);
								float maxRGBSum = -1.0;

								vec4 neighbors[8] = vec4[8](left, right, top, bottom, topLeft, topRight, bottomLeft, bottomRight);

								for (int i = 0; i < 8; i++) {
										if (neighbors[i].a == maxAlpha) {
												float currentRGBSum = rgbSum(neighbors[i].rgb);
												if (currentRGBSum > maxRGBSum) {
														maxRGBSum = currentRGBSum;
														result = neighbors[i];
												}
										}
								}

								gl_FragColor.rgb = result.rgb;
						} else {
								// If no opaque neighbors, keep the pixel transparent
								gl_FragColor = center;
						}
				}`
		} );
		this._fsQuad = new FullScreenQuad( this._shader );

	}

	expand( texture, renderTarget, iterations = 1 ) {

		const width = texture.image.width;
		const height = texture.image.height;
		const { _shader: shader, _renderer: renderer, _fsQuad: fsQuad } = this;

		const originalClearColor = new THREE.Color();

		renderer.getClearColor( originalClearColor );
		renderer.setClearColor( 0x000000, 0 );
		const originalRenderTarget = renderer.getRenderTarget();

		let renderTargetA = new THREE.WebGLRenderTarget( width, height, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType
		} );
		let renderTargetB = renderTargetA.clone();

		shader.uniforms.texelSize.value.set( 1 / width, 1 / height );

		// Initial render
		shader.uniforms.inputTexture.value = texture;
		renderer.setRenderTarget( iterations == 1 ? renderTarget : renderTargetA );
		fsQuad.render( renderer );

		// Iterative expansion
		for ( let i = 0; i < iterations - 1; i ++ ) {

			shader.uniforms.inputTexture.value = renderTargetA.texture;

			if ( i === iterations - 2 ) {

				renderer.setRenderTarget( renderTarget );

			} else {

				renderer.setRenderTarget( renderTargetB );

			}


			fsQuad.render( renderer );

			// Swap render targets
			[ renderTargetA, renderTargetB ] = [ renderTargetB, renderTargetA ];

		}


		renderTargetA.dispose();
		renderTargetB.dispose();

		renderer.setClearColor( originalClearColor );
		renderer.setRenderTarget( originalRenderTarget );

	}


	dispose() {

		this._shader.dispose();
		this._fsQuad.dispose();

	}

}
