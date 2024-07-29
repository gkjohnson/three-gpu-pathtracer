import { NoBlending } from 'three';
import { MaterialBase } from '../MaterialBase.js';

export class DenoiserSplitMaterial extends MaterialBase {

	constructor( parameters ) {

		super( {

			blending: NoBlending,

			uniforms: {

				map1: { value: null },
				map2: { value: null },
				splitPoint: { value: 0 }

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

			fragmentShader: /* glsl */`

			uniform float opacity;
			uniform sampler2D map1;
			uniform sampler2D map2;
			uniform float splitPoint;
			varying vec2 vUv;

			void main() {
				vec4 color1 = texture2D(map1, vUv);
				vec4 color2 = texture2D(map2, vUv);
				vec4 finalColor;

				// splitter to test colors

				if (vUv.x > splitPoint) {
					finalColor = color2;
				} else {
					finalColor = color1;
				}

				#if defined( TONE_MAPPING )

					 finalColor.xyz = toneMapping( finalColor.xyz );

				#endif

				gl_FragColor = linearToOutputTexel( finalColor );
			}`

		} );

		this.setValues( parameters );

	}

}
