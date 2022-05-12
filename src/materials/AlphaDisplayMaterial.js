import { NoBlending } from 'three';
import { MaterialBase } from './MaterialBase.js';

export class AlphaDisplayMaterial extends MaterialBase {

	constructor( parameters ) {

		super( {

			uniforms: {

				map: { value: null },

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

				varying vec2 vUv;

				void main() {

					gl_FragColor = vec4( texture( map, vUv ).a );
					gl_FragColor.a = 1.0;

				}`

		} );

		this.setValues( parameters );

	}

}
