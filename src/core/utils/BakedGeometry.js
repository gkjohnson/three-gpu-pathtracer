import { BufferGeometry } from 'three';
import { MeshDiff } from './MeshDiff.js';
import { convertToStaticGeometry } from './convertToStaticGeometry.js';

export class BakedGeometry extends BufferGeometry {

	constructor() {

		super();
		this.version = 0;
		this.hash = null;
		this._diff = new MeshDiff();

	}

	updateFrom( mesh, options ) {

		const diff = this._diff;
		if ( diff.didChange( mesh ) ) {

			convertToStaticGeometry( mesh, options, this );
			diff.updateFrom( mesh );
			this.version ++;
			this.hash = `${ this.uuid }_${ this.version }`;
			return true;

		} else {

			return false;

		}

	}

}
