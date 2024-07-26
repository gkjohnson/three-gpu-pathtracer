import { reverse } from 'dns';
import { ShaderMaterial } from 'three';

// Material that tone maps a texture before performing interpolation to prevent
// unexpected high values during texture stretching interpolation.
// Emulates browser image stretching
export class LinearToSRGBMaterial extends ShaderMaterial {

	get map() {

		return this.uniforms.map.value;

	}

	set map( v ) {

		this.uniforms.map.value = v;

	}

	constructor( params ) {

		super( {
			uniforms: {

				map: { value: null },
				skipToneMapping: { value: false },
				skipConversion: { value: false },
				reverseConversion: { value: false },

			},

			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,

			fragmentShader: /* glsl */`
				uniform sampler2D map;
				uniform bool skipToneMapping;
				uniform bool skipConversion;
				uniform bool reverseConversion;
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

				void main() {

					vec4 color = texture2D( map, vUv );
					if ( skipConversion == false ) finalColor = LinearToSRGB( color );
					gl_FragColor = finalColor;

				}
			`
		} );

		this.setValues( params );

	}

}
