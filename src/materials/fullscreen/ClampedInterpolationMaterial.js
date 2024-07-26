import { ShaderMaterial } from 'three';

// Material that tone maps a texture before performing interpolation to prevent
// unexpected high values during texture stretching interpolation.
// Emulates browser image stretching
export class ClampedInterpolationMaterial extends ShaderMaterial {

	get map() {

		return this.uniforms.map.value;

	}

	set map( v ) {

		this.uniforms.map.value = v;

	}

	get opacity() {

		return this.uniforms.opacity.value;

	}

	set opacity( v ) {

		if ( this.uniforms ) {

			this.uniforms.opacity.value = v;

		}

	}

	constructor( params ) {

		super( {
			uniforms: {

				map: { value: null },
				opacity: { value: 1 },
				convertToSRGB: { value: false }

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
				uniform float opacity;
				uniform bool convertToSRGB;
				varying vec2 vUv;

				vec4 clampedTexelFatch( sampler2D map, ivec2 px, int lod ) {

					vec4 res = texelFetch( map, ivec2( px.x, px.y ), 0 );

					#if defined( TONE_MAPPING )
					 res.xyz = toneMapping( res.xyz );

					#endif

			  		return linearToOutputTexel( res );

				}

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

					vec2 size = vec2( textureSize( map, 0 ) );
					vec2 pxUv = vUv * size;
					vec2 pxCurr = floor( pxUv );
					vec2 pxFrac = fract( pxUv ) - 0.5;
					vec2 pxOffset;
					pxOffset.x = pxFrac.x > 0.0 ? 1.0 : - 1.0;
					pxOffset.y = pxFrac.y > 0.0 ? 1.0 : - 1.0;

					vec2 pxNext = clamp( pxOffset + pxCurr, vec2( 0.0 ), size - 1.0 );
					vec2 alpha = abs( pxFrac );

					vec4 p1 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxCurr.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxCurr.y ), 0 ),
						alpha.x
					);

					vec4 p2 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxNext.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxNext.y ), 0 ),
						alpha.x
					);

					vec4 finalColor = mix( p1, p2, alpha.y );
					finalColor.a *= opacity;
					if ( convertToSRGB ) finalColor = LinearToSRGB( finalColor );
					gl_FragColor = finalColor;

					#include <premultiplied_alpha_fragment>

				}
			`
		} );

		this.setValues( params );

	}

}
