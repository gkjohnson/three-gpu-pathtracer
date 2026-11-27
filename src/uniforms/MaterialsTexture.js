export class MaterialFeatures {

	constructor() {

		this._features = {};

	}

	isUsed( feature ) {

		return feature in this._features;

	}

	getUsedFeatures() {

		return Object.keys( this._features );

	}

	setUsed( feature, used = true ) {

		if ( used === false ) {

			delete this._features[ feature ];

		} else {

			this._features[ feature ] = true;

		}

	}

	reset() {

		this._features = {};

	}

}
