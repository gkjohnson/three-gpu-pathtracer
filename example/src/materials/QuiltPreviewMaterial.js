import { Vector2, CustomBlending } from 'three';
import { MaterialBase } from '../../src/materials/MaterialBase.js';

export class QuiltPreviewMaterial extends MaterialBase {

	constructor( parameters ) {

		super( {

			depthWrite: false,
			blending: CustomBlending,

			uniforms: {

				quiltMap: { value: null },
				quiltDimensions: { value: new Vector2() },
				displayIndex: { value: 0 },
				aspectRatio: { value: 1 },
				heightScale: { value: 0.75 },

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					vUv = uv;

				}

			`,

			fragmentShader: /* glsl */`

				varying vec2 vUv;
				uniform sampler2D quiltMap;
				uniform ivec2 quiltDimensions;
				uniform int displayIndex;
				uniform float aspectRatio;
				uniform float heightScale;

				void main() {

					vec2 tileUv = vUv;
					tileUv.x -= ( 1.0 - aspectRatio * heightScale ) * 0.5;
					tileUv.x /= aspectRatio;

					tileUv.y -= ( 1.0 - heightScale ) * 0.5;
					tileUv /= heightScale;

					if ( tileUv.x < 0.0 || tileUv.x > 1.0 || tileUv.y < 0.0 || tileUv.y > 1.0 ) {

						gl_FragColor = vec4( 0.05, 0.05, 0.05, 1.0 );
						return;

					}

					ivec2 size = textureSize( quiltMap, 0 );
					vec2 texelWidth = 1.0 / vec2( size );
					vec2 tileTexelHalfWidth = 0.5 * vec2( quiltDimensions ) * texelWidth;
					tileUv = max( tileTexelHalfWidth, min( 1.0 - tileTexelHalfWidth, tileUv ) );

					ivec2 tileIndex = ivec2( 0 );
					tileIndex.x = displayIndex % quiltDimensions.x;
					tileIndex.y = ( displayIndex - tileIndex.x ) / quiltDimensions.x;

					vec2 tileWidth = 1.0 / vec2( quiltDimensions );
					vec2 quiltUv = tileWidth * ( vec2( tileIndex ) + tileUv );

					gl_FragColor = texture( quiltMap, quiltUv );

					#include <tonemapping_fragment>
					#include <colorspace_fragment>

				}

			`,

		} );

		this.setValues( parameters );

	}

}

