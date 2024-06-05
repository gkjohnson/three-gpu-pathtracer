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
	isCompatible( mesh, attributes ) {

		const geometry = mesh.geometry;
		for ( let i = 0; i < attributes.length; i ++ ) {

			const key = attributes[ i ];
			const attr1 = geometry.attributes[ key ];
			const attr2 = this.attributes[ key ];
			if ( attr1 && ! validateAttributes( attr1, attr2 ) ) {

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
