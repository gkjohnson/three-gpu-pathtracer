import { NoBlending } from 'three';
import { MaterialBase } from '../MaterialBase.js';

export class BlendMaterial extends MaterialBase {

	constructor( parameters ) {

		super( {

			blending: NoBlending,

			uniforms: {

				target1: { value: null },
				target2: { value: null },
				opacity: { value: 1.0 },
				t2conversion: { value: false },
				doSplit: { value: false },
				splitPoint: { value: 0.5 }

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

			fragmentShader: /* glsl */`

			uniform float opacity;
			uniform sampler2D target1;
			uniform sampler2D target2;
			uniform bool t2conversion;
			uniform bool doSplit;
			uniform float splitPoint;
			varying vec2 vUv;
			
			vec4 LinearToSRGB(vec4 value) {
				vec3 linearRGB = value.rgb;
				vec3 sRGB = vec3(0.0); // Initialize sRGB to zero
			
				for (int i = 0; i < 3; ++i) {
					if (linearRGB[i] <= 0.0031308) {
						sRGB[i] = 12.92 * linearRGB[i];
					} else {
						sRGB[i] = 1.055 * pow(linearRGB[i], 1.0 / 2.4) - 0.055;
					}
				}
			
				return vec4(sRGB, value.a);
			}
			
			vec4 SRGBToLinear(vec4 value) {
				return vec4(pow(value.rgb, vec3(2.2)), value.a);
			}
			
			void main() {
				vec4 color1 = texture2D(target1, vUv);
				vec4 color2 = texture2D(target2, vUv);
			
				if (t2conversion) {
					color2 = LinearToSRGB(color2);
				}
			
				float invOpacity = 1.0 - opacity;
				float totalAlpha = color1.a * invOpacity + color2.a * opacity;
			
				vec4 finalColor = vec4(0.0); // Initialize finalColor to zero
			
				if (color1.a != 0.0 || color2.a != 0.0) {
					finalColor.rgb = color1.rgb * (invOpacity * color1.a / totalAlpha) + color2.rgb * (opacity * color2.a / totalAlpha);
					finalColor.a = totalAlpha;
				}
			
				// splitter to test colors
				if (doSplit) {
					if (vUv.x > splitPoint) {
						finalColor = color2;
					} else {
						finalColor = color1;
					}
				}
			
				gl_FragColor = finalColor;
			}`

		} );

		this.setValues( parameters );

	}

}
