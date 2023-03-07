import { MaterialBase } from '../materials/MaterialBase.js';

const computePrecisionFunction = /* glsl */`
    precision highp float;
    precision highp int;
    struct FloatStruct {
        highp float value;
    };

    struct IntStruct {
        highp int value;
    };

    struct UintStruct {
        highp uint value;
    };

    vec2 computePrecision() {

        #if MODE == 0 // float

            float exponent = 0.0;
            float value = 1.5;
            while ( value > 1.0 ) {

                exponent ++;
                value = 1.0 + pow( 2.0, - exponent ) / 2.0;

            }

            float structExponent = 0.0;
            FloatStruct str;
            str.value = 1.5;
            while ( str.value > 1.0 ) {

                structExponent ++;
                str.value = 1.0 + pow( 2.0, - structExponent ) / 2.0;

            }

            return vec2( exponent, structExponent );


        #elif MODE == 1 // int

            int bits = 0;
            int value = 1;
            while ( value > 0 ) {

                value = value << 1;
                value = value | 1;
                bits ++;

            }

            int structBits = 0;
            IntStruct str;
            str.value = 1;
            while ( str.value > 0 ) {

                str.value = str.value << 1;
                str.value = str.value | 1;
                structBits ++;

            }

            return vec2( bits, structBits );

        #else // uint

            int bits = 0;
            uint value = 1u;
            while ( value > 0u ) {

                value = value << 1u;
                bits ++;

            }

            int structBits = 0;
            UintStruct str;
            str.value = 1u;
            while( str.value > 0u ) {

                str.value = str.value << 1u;
                structBits ++;

            }

            return vec2( bits, structBits );

        #endif

    }


`;

export class PrecisionMaterial extends MaterialBase {

	set mode( v ) {

		this._mode = v;

		switch ( v.toLowerCase() ) {

		case 'float':
			this.setDefine( 'MODE', 0 );
			break;
		case 'int':
			this.setDefine( 'MODE', 1 );
			break;
		case 'uint':
			this.setDefine( 'MODE', 2 );
			break;

		}

	}

	constructor() {

		super( {

			vertexShader: /* glsl */`

				${ computePrecisionFunction }

				varying vec2 vPrecision;
				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					vPrecision = computePrecision();

				}

			`,

			fragmentShader: /* glsl */`

				${ computePrecisionFunction }

				varying vec2 vPrecision;
				void main( void ) {

					vec2 fPrecision = computePrecision();
					gl_FragColor = vec4( vPrecision, fPrecision ) / 255.0;

				}

			`,

		} );

	}

}
