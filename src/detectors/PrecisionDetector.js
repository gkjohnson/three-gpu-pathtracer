import { WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { PrecisionMaterial } from './PrecisionMaterial.js';

// see https://github.com/gkjohnson/webgl-precision
// Returns whether the platform can use highp precision consistently in structs
export class PrecisionDetector {

	constructor( renderer ) {

		this._renderer = renderer;
		this._result = null;

	}

	detect() {

		if ( this._result ) {

			return this._result;

		}

		const renderer = this._renderer;
		const material = new PrecisionMaterial();
		const quad = new FullScreenQuad( material );
		const target = new WebGLRenderTarget( 1, 1 );
		const ogTarget = renderer.getRenderTarget();

		const detail = {
			'int': extractResult( 'int' ),
			'uint': extractResult( 'uint' ),
			'float': extractResult( 'float' ),
		};

		const message = doesPass( 'int', detail.int ) || doesPass( 'uint', detail.uint ) || doesPass( 'float', detail.float );
		this._result = {
			detail,
			message,
			pass: ! Boolean( message ),
		};

		renderer.setRenderTarget( ogTarget );
		quad.dispose();
		target.dispose();
		material.dispose();
		return this._result;

		function doesPass( type, info ) {

			if ( info.vertex === info.vertexStruct && info.fragment === info.fragmentStruct ) {

				return '';

			} else {

				return `Type "${ type }" cannot correctly provide highp precision in structs.`;

			}

		}

		function extractResult( mode ) {

			material.mode = mode;
			renderer.setRenderTarget( target );
			quad.render( renderer );

			const readBuffer = new Uint8Array( 4 );
			renderer.readRenderTargetPixels( target, 0, 0, 1, 1, readBuffer );

			return {

				vertex: readBuffer[ 0 ],
				vertexStruct: readBuffer[ 1 ],
				fragment: readBuffer[ 2 ],
				fragmentStruct: readBuffer[ 3 ],

			};

		}

	}

}
