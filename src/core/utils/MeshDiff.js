import { Matrix4 } from 'three';

function attributeSort( a, b ) {

	if ( a.uuid > b.uuid ) return 1;
	if ( a.uuid < b.uuid ) return - 1;
	return 0;

}

function getGeometryHash( geometry ) {

	let hash = '';
	const attributes = Object.values( geometry.attributes );
	if ( geometry.index ) {

		attributes.push( geometry.index );

	}

	attributes.sort( attributeSort );

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
export class MeshDiff {

	constructor( mesh = null ) {

		this.matrixWorld = new Matrix4();
		this.geometryHash = null;
		this.skeletonHash = null;
		this.primitiveCount = - 1;

		if ( mesh !== null ) {

			this.updateFrom( mesh );

		}

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
			this.primitiveCount === primitiveCount;

		return ! identical;

	}

}
