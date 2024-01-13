import { Color, NoBlending } from 'three';
import { MaterialBase } from '../MaterialBase.js';

export class GradientMapMaterial extends MaterialBase {

	constructor( parameters ) {

		super( {

			defines: {

				FEATURE_BIN: 0,

			},

			uniforms: {

				map: { value: null },

				minColor: { value: new Color( 0 ) },
				minValue: { value: 0 },

				maxColor: { value: new Color( 0xffffff ) },
				maxValue: { value: 10 },

				field: { value: 0 },
				power: { value: 1 },

			},

			blending: NoBlending,

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

			fragmentShader: /* glsl */`

				uniform sampler2D map;
				uniform vec3 minColor;
				uniform float minValue;
				uniform vec3 maxColor;
				uniform float maxValue;
				uniform int field;
				uniform float power;

				varying vec2 vUv;

				void main() {

					float value = texture( map, vUv )[ field ];

					#if FEATURE_BIN

					value = ceil( value );

					#endif

					float t = smoothstep( minValue, maxValue, value );
					t = pow( t, power );

					gl_FragColor.rgb = vec3( mix( minColor, maxColor, t ) );
					gl_FragColor.a = 1.0;

					#include <colorspace_fragment>

				}`,

		} );

		this.setValues( parameters );

	}

}
