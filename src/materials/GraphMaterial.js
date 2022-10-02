import { NoBlending, Color, Vector2, Vector4 } from 'three';
import { MaterialBase } from './MaterialBase.js';

export class GraphMaterial extends MaterialBase {

	get graphFunctionSnippet() {

		return this._graphFunctionSnippet;

	}

	set graphFunctionSnippet( v ) {

		this._graphFunctionSnippet = v;

	}

	constructor( parameters ) {

		super( {

			blending: NoBlending,

			transparent: false,

			depthWrite: false,

			depthTest: false,

			defines: {

				USE_SLIDER: 0,

			},

			uniforms: {

				dim: { value: true },
				thickness: { value: 1 },
				graphCount: { value: 4 },
				graphDisplay: { value: new Vector4( 1.0, 1.0, 1.0, 1.0 ) },
				overlay: { value: true },
				xRange: { value: new Vector2( - 2.0, 2.0 ) },
				yRange: { value: new Vector2( - 2.0, 2.0 ) },
				colors: { value: [
					new Color( 0xe91e63 ).convertSRGBToLinear(),
					new Color( 0x4caf50 ).convertSRGBToLinear(),
					new Color( 0x03a9f4 ).convertSRGBToLinear(),
					new Color( 0xffc107 ).convertSRGBToLinear(),
				] },

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,

			fragmentShader: /* glsl */`
				varying vec2 vUv;
				uniform bool overlay;
				uniform bool dim;
				uniform bvec4 graphDisplay;
				uniform float graphCount;
				uniform float thickness;
				uniform vec2 xRange;
				uniform vec2 yRange;
				uniform vec3 colors[ 4 ];

				__FUNCTION_CONTENT__

				float map( float _min, float _max, float v ) {

					float len = _max - _min;
					return _min + len * v;

				}

				vec3 getBackground( vec2 point, float steepness ) {

					vec2 pw = fwidth( point );
					vec2 halfWidth = pw * 0.5;

					// x, y axes
					vec2 distToZero = smoothstep(
						- halfWidth * 0.5,
						halfWidth * 0.5,
						abs( point.xy ) - pw
					);

					// 1 unit markers
					vec2 temp;
					vec2 modAxis = abs( modf( point + vec2( 0.5 ), temp ) ) - 0.5;
					vec2 distToAxis = smoothstep(
						- halfWidth,
						halfWidth,
						abs( modAxis.xy ) - pw * 0.5
					);

					// if we're at a chart boundary then remove the artifacts
					if ( abs( pw.y ) > steepness * 0.5 ) {

						distToZero.y = 1.0;
						distToAxis.y = 1.0;

					}

					// mix colors into a background color
					float axisIntensity = 1.0 - min( distToZero.x, distToZero.y );
					float markerIntensity = 1.0 - min( distToAxis.x, distToAxis.y );

					vec3 markerColor = mix( vec3( 0.005 ), vec3( 0.05 ), markerIntensity );
					vec3 backgroundColor = mix( markerColor, vec3( 0.2 ), axisIntensity );
					return backgroundColor;

				}

				void main() {

					// from uniforms
					float sectionCount = overlay ? 1.0 : graphCount;
					float yWidth = abs( yRange.y - yRange.x );

					// separate into sections
					float _section;
					float sectionY = modf( sectionCount * vUv.y, _section );
					int section = int( sectionCount - _section - 1.0 );

					// get the current point
					vec2 point = vec2(
						map( xRange.x, xRange.y, vUv.x ),
						map( yRange.x, yRange.y, sectionY )
					);

					// get the results
					vec4 result = graphFunction( point.x );
					vec4 delta = result - vec4( point.y );
					vec4 halfDdf = fwidth( delta ) * 0.5;
					if ( fwidth( point.y ) > yWidth * 0.5 ) {

						halfDdf = vec4( 0.0 );

					}

					// graph display intensity
					vec4 graph = smoothstep( - halfDdf, halfDdf, abs( delta ) - thickness * halfDdf );

					// initialize the background
					gl_FragColor.rgb = getBackground( point, yWidth );
					gl_FragColor.a = 1.0;

					if ( dim && ( point.x < 0.0 || point.y < 0.0 ) ) {

						graph = mix(
							vec4( 1.0 ),
							graph,
							0.05
						);

					}

					// color the charts
					if ( sectionCount > 1.0 ) {

						if ( graphDisplay[ section ] ) {

							gl_FragColor.rgb = mix(
								colors[ section ],
								gl_FragColor.rgb,
								graph[ section ]
							);

						}

					} else {

						for ( int i = 0; i < int( graphCount ); i ++ ) {

							if ( graphDisplay[ i ] ) {

								gl_FragColor.rgb = mix(
									colors[ i ],
									gl_FragColor.rgb,
									graph[ i ]
								);

							}

						}

					}

					#include <encodings_fragment>

				}

			`

		} );


		this._graphFunctionSnippet = /* glsl */`
			vec4 graphFunctionSnippet( float x ) {

				return vec4(
					sin( x * 3.1415926535 ),
					cos( x ),
					0.0,
					0.0
				);

			}
		`;

		this.setValues( parameters );

	}

	onBeforeCompile( shader ) {

		shader.fragmentShader = shader.fragmentShader.replace(
			'__FUNCTION_CONTENT__',
			this._graphFunctionSnippet,
		);
		return shader;

	}

	customProgramCacheKey() {

		return this._graphFunctionSnippet;

	}

}
