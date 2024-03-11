import { FloatType, NearestFilter, NoBlending, RGBAFormat, Vector2, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { MaterialBase } from '../materials/MaterialBase.js';
import { sobol_common, sobol_point_generation } from '../shader/rand/sobol.glsl.js';

class SobolNumbersMaterial extends MaterialBase {

	constructor() {

		super( {

			blending: NoBlending,

			uniforms: {

				resolution: { value: new Vector2() },

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,

			fragmentShader: /* glsl */`

				${ sobol_common }
				${ sobol_point_generation }

				varying vec2 vUv;
				uniform vec2 resolution;
				void main() {

					uint index = uint( gl_FragCoord.y ) * uint( resolution.x ) + uint( gl_FragCoord.x );
					gl_FragColor = generateSobolPoint( index );

				}
			`,

		} );

	}

}

export class SobolNumberMapGenerator {

	generate( renderer, dimensions = 256 ) {

		const target = new WebGLRenderTarget( dimensions, dimensions, {

			type: FloatType,
			format: RGBAFormat,
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			generateMipmaps: false,

		} );

		const ogTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( target );

		const quad = new FullScreenQuad( new SobolNumbersMaterial() );
		quad.material.resolution.set( dimensions, dimensions );
		quad.render( renderer );

		renderer.setRenderTarget( ogTarget );
		quad.dispose();

		return target;

	}

}
