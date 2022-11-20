import { MaterialBase } from '../../materials/MaterialBase.js';

const vertexShader = /* glsl */`
    varying vec2 vUv;

    void main() {

        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4( position.xy, 1.0, 1.0 );

    }
`;

const fragmentShader = /* glsl */`
    varying vec2 vUv;

    uniform sampler2D temporalResolveTexture;

    void main() {

        vec4 temporalResolveTexel = texture2D( temporalResolveTexture, vUv );

        bool isBackgroundTile = temporalResolveTexel.a == 0.0;

        gl_FragColor = vec4( temporalResolveTexel.rgb, isBackgroundTile ? 0.0 : 1.0 );

    }
`;

export class ComposeTemporalResolveMaterial extends MaterialBase {

	constructor() {

		super( {
			vertexShader,
			fragmentShader,
			uniforms: {
				temporalResolveTexture: { value: null },
			},
		} );

	}

}
