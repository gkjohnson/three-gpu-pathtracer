import { WebGLRenderTarget, RGBAFormat, FloatType, PMREMGenerator, DataTexture } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { MaterialBase } from '../materials/MaterialBase.js';
import { shaderEnvMapSampling } from '../shader/shaderEnvMapSampling.js';

class PMREMCopyMaterial extends MaterialBase {

	constructor() {

		super( {

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

				#include <common>
				#include <cube_uv_reflection_fragment>

				vec3 equirectUvToDirection( vec2 uv ) {

					// undo above adjustments
					uv.x -= 0.5;
					uv.y = 1.0 - uv.y;

					// from Vector3.setFromSphericalCoords
					float theta = uv.x * 2.0 * PI;
					float phi = uv.y * PI;

					float sinPhi = sin( phi );

					return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

				}

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
		const { width, height } = texture.image;
		renderTarget.setSize( width, height );
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

		const result = new DataTexture( buffer, width, height, RGBAFormat, FloatType );
		result.minFilter = texture.minFilter;
		result.magFilter = texture.magFilter;
		result.wrapS = texture.wrapS;
		result.wrapT = texture.wrapT;
		return result;

	}

}
