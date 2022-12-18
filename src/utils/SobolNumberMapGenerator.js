import { FloatType, NearestFilter, NoBlending, RGBAFormat, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass';
import { MaterialBase } from '../materials/MaterialBase.js';
import { shaderSobolCommon, shaderSobolGeneration } from '../shader/shaderSobolSampling.js';

class SobolNumbersMaterial extends MaterialBase {

	constructor() {

		super( {

			blending: NoBlending,

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,

			fragmentShader: /* glsl */`

				${ shaderSobolCommon }
				${ shaderSobolGeneration }

				varying vec2 vUv;
				void main() {

					vec2 resolution = 1.0 / fwidth( vUv );
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
		quad.render( renderer );

		renderer.setRenderTarget( ogTarget );
		quad.dispose();

		return target;

	}

}
