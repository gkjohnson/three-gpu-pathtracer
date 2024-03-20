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
			if ( a.uuid < b.uuid ) return - 1;
			return 0;

		} );

	for ( const attr of attributes ) {

		hash += `${ attr.uuid }_${ attr.version }|`;

	}

	return hash;

}

function getSkeletonHash( mesh ) {

	const skeleton = mesh.skeleton;
	if ( skeleton ) {

		if ( ! skeleton.boneTexture ) {

			skeleton.computeBoneTexture();

		}

		return `${ skeleton.boneTexture.version }_${ skeleton.boneTexture.uuid }`;

	} else {

		return null;

	}

}

// Checks whether the geometry changed between this and last evaluation
export class GeometryDiff {

	constructor( mesh ) {

		this.matrixWorld = new Matrix4();
		this.geometryHash = null;
		this.skeletonHash = null;
		this.primitiveCount = - 1;

		this.updateFrom( mesh );

	}

	updateFrom( mesh ) {

		const geometry = mesh.geometry;
		const primitiveCount = ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;
		this.matrixWorld.copy( mesh.matrixWorld );
		this.geometryHash = getGeometryHash( geometry );
		this.primitiveCount = primitiveCount;
		this.skeletonHash = getSkeletonHash( mesh );

	}

	didChange( mesh ) {

		const geometry = mesh.geometry;
		const primitiveCount = ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;
		const identical =
			this.matrixWorld.equals( mesh.matrixWorld ) &&
			this.geometryHash === getGeometryHash( geometry ) &&
			this.skeletonHash === getSkeletonHash( mesh ) &&
			checkTypedArrayEquality( mesh.skeleton && mesh.skeleton.boneMatrices || null, this.boneMatrices ) &&
			this.primitiveCount === primitiveCount;

		return ! identical;

	}

}
