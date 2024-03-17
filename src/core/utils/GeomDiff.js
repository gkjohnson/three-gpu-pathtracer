import { Matrix4 } from 'three';

function checkTypedArrayEquality( a, b ) {

	if ( a === null || b === null ) {

		return a === b;

	}

	if ( a.length !== b.length ) {

		return false;

	}

	for ( let i = 0, l = a.length; i < l; i ++ ) {

		if ( a[ i ] !== b[ i ] ) {

			return false;

		}

	}

	return true;

}

function getGeometryHash( geometry ) {

	let hash = '';
	const attributes = [ geometry.index, ...Object.values( geometry.attributes ) ]
		.sort( ( a, b ) => {

			if ( a.uuid > b.uuid ) return 1;
			if ( b.uuid < b.uuid ) return - 1;
			return 0;

		} );

	for ( const key in attributes ) {

		const attr = attributes[ key ];
		hash += `${ attr.uuid }_${ attr.version }|`;

	}

	return hash;

}

// Checks whether the geometry changed between this and last evaluation
export class GeometryDiff {

	constructor( mesh ) {

		this.matrixWorld = new Matrix4();
		this.geometryHash = null;
		this.boneMatrices = null;
		this.primitiveCount = - 1;
		this.mesh = mesh;

		this.update();

	}

	update() {

		const mesh = this.mesh;
		const geometry = mesh.geometry;
		const skeleton = mesh.skeleton;
		const primitiveCount = ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;
		this.matrixWorld.copy( mesh.matrixWorld );
		this.geometryHash = getGeometryHash( geometry );
		this.primitiveCount = primitiveCount;

		if ( skeleton ) {

			// ensure the bone matrix array is updated to the appropriate length
			if ( ! skeleton.boneTexture ) {

				skeleton.computeBoneTexture();

			}

			skeleton.update();

			// copy data if possible otherwise clone it
			const boneMatrices = skeleton.boneMatrices;
			if ( ! this.boneMatrices || this.boneMatrices.length !== boneMatrices.length ) {

				this.boneMatrices = boneMatrices.slice();

			} else {

				this.boneMatrices.set( boneMatrices );

			}

		} else {

			this.boneMatrices = null;

		}

	}

	didChange() {

		const mesh = this.mesh;
		const geometry = mesh.geometry;
		const primitiveCount = ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;
		const identical =
			this.matrixWorld.equals( mesh.matrixWorld ) &&
			this.geometryHash === getGeometryHash( geometry ) &&
			checkTypedArrayEquality( mesh.skeleton && mesh.skeleton.boneMatrices || null, this.boneMatrices ) &&
			this.primitiveCount === primitiveCount;

		return ! identical;

	}

}
