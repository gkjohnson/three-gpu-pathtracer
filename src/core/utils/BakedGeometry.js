import { BufferGeometry } from 'three';
import { MeshDiff } from './MeshDiff.js';
import { convertToStaticGeometry } from './convertToStaticGeometry.js';
import { validateAttributes } from './BufferAttributeUtils.js';

export class BakedGeometry extends BufferGeometry {

	constructor() {

		super();
		this.version = 0;
		this.hash = null;
		this._diff = new MeshDiff();

	}

	// returns whether the passed mesh is compatible with this baked geometry
	// such that it can be updated without resizing attributes
	isCompatible( mesh ) {

		const geometry = mesh.geometry;
		const attributes = geometry.attributes;
		for ( const key in attributes ) {

			const attr1 = attributes[ key ];
			const attr2 = this.attributes[ key ];
			if ( ! validateAttributes( attr1, attr2 ) ) {

				return false;

			}

		}

		return true;

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
