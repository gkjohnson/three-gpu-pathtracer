import { PrecisionDetector } from './PrecisionDetector.js';
import { MaterialCompileDetector } from './MaterialCompileDetector.js';
export class CompatibilityDetector {

	constructor( renderer, material ) {

		this._renderer = renderer;
		this._material = material;

	}

	detect() {

		let detector = new PrecisionDetector( this._renderer );
		let result = detector.detect();
		if ( ! result.pass ) {

			return result;

		}

		detector = new MaterialCompileDetector( this._renderer );
		result = detector.detect( this._material );
		if ( ! result.pass ) {

			return result;

		}

		return {
			detail: {},
			pass: true,
			message: '',
		};

	}

}
