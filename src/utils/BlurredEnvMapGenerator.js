import { WebGLRenderTarget, RGBAFormat, FloatType, PMREMGenerator, ShaderMaterial, DataTexture } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { MaterialBase } from '../materials/MaterialBase.js';
import { shaderEnvMapSampling } from '../shader/shaderEnvMapSampling.js';

class PMREMCopyMaterial extends MaterialBase {

	constructor() {

		return new ShaderMaterial( {

			uniforms: {

				envMap: { value: null },
				blur: { value: 0 },

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}

			`,

			fragmentShader: /* glsl */`

				${ shaderEnvMapSampling }

				uniform sampler2D envMap;
				uniform float blur;
				varying vec2 vUv;
				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					gl_FragColor = textureCubeUV( envMap, rayDirection, blur );

				}

			`,

		} );

	}

}

export class BlurredEnvMapGenerator {

	constructor( renderer ) {

		this.renderer = renderer;
		this.pmremGenerator = new PMREMGenerator( renderer );
		this.copyQuad = new FullScreenQuad( new PMREMCopyMaterial() );
		this.renderTarget = new WebGLRenderTarget( 1, 1, { type: FloatType, format: RGBAFormat } );

	}

	dispose() {

		this.pmremGenerator.dispose();
		this.copyQuad.dispose();

	}

	generate( texture, blur ) {

		const { pmremGenerator, renderTarget, copyQuad, renderer } = this;

		// get the pmrem target
		const pmremTarget = pmremGenerator.fromEquirectangular( texture );

		// set up the material
		const { width, height } = texture.width;
		renderTarget.setSize( texture.width, texture.height );
		copyQuad.material.envMap = pmremTarget.texture;
		copyQuad.material.blur = blur;

		// render
		const prevRenderTarget = renderer.getRenderTarget();
		const prevClear = renderer.autoClear;

		renderer.setRenderTarget( renderTarget );
		renderer.autoClear = true;
		copyQuad.render( renderer );

		renderer.setRenderTarget( prevRenderTarget );
		renderer.autoClear = prevClear;

		// read the data back
		const buffer = new Float32Array( width * height * 4 );
		renderer.readRenderTargetPixels( renderTarget, 0, 0, width, height, buffer );

		return new DataTexture( buffer, width, height, RGBAFormat, FloatType );

	}

}
