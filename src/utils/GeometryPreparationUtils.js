import { BufferAttribute } from 'three';
import { mergeBufferGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
export function getGroupMaterialIndicesAttribute( geometry, materials, allMaterials ) {

	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	const vertCount = posAttr.count;
	const materialArray = new Uint8Array( vertCount );
	const totalCount = indexAttr ? indexAttr.count : vertCount;
	let groups = geometry.groups;
	if ( groups.length === 0 ) {

		groups = [ { count: totalCount, start: 0, materialIndex: 0 } ];

	}

	for ( let i = 0; i < groups.length; i ++ ) {

		const group = groups[ i ];
		const start = group.start;
		const count = group.count;
		const endCount = Math.min( count, totalCount - start );

		const mat = Array.isArray( materials ) ? materials[ group.materialIndex ] : materials;
		const materialIndex = allMaterials.indexOf( mat );

		for ( let j = 0; j < endCount; j ++ ) {

			let index = start + j;
			if ( indexAttr ) {

				index = indexAttr.getX( index );

			}

			materialArray[ index ] = materialIndex;

		}

	}

	return new BufferAttribute( materialArray, 1, false );

}

export function trimToAttributes( geometry, attributes ) {

	// trim any unneeded attributes
	if ( attributes ) {

		for ( const key in geometry.attributes ) {

			if ( ! attributes.includes( key ) ) {

				geometry.deleteAttribute( key );

			}

		}

	}

}

export function setCommonAttributes( geometry, options ) {

	const { attributes = [], normalMapRequired = false } = options;

	if ( ! geometry.attributes.normal && ( attributes && attributes.includes( 'normal' ) ) ) {

		geometry.computeVertexNormals();

	}

	if ( ! geometry.attributes.uv && ( attributes && attributes.includes( 'uv' ) ) ) {

		const vertCount = geometry.attributes.position.count;
		geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( vertCount * 2 ), 2, false ) );

	}

	if ( ! geometry.attributes.tangent && ( attributes && attributes.includes( 'tangent' ) ) ) {

		if ( normalMapRequired ) {

			// computeTangents requires an index buffer
			if ( geometry.index === null ) {

				geometry = mergeVertices( geometry );

			}

			geometry.computeTangents();

		} else {

			const vertCount = geometry.attributes.position.count;
			geometry.setAttribute( 'tangent', new BufferAttribute( new Float32Array( vertCount * 4 ), 4, false ) );

		}

	}

	if ( ! geometry.index ) {

		// TODO: compute a typed array
		const indexCount = geometry.attributes.position.count;
		const array = new Array( indexCount );
		for ( let i = 0; i < indexCount; i ++ ) {

			array[ i ] = i;

		}

		geometry.setIndex( array );

	}

}

export function mergeMeshes( meshes, options = {} ) {

	options = { attributes: null, cloneGeometry: true, ...options };

	const transformedGeometry = [];
	const materialSet = new Set();
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		// save any materials
		const mesh = meshes[ i ];
		if ( mesh.visible === false ) continue;

		if ( Array.isArray( mesh.material ) ) {

			mesh.material.forEach( m => materialSet.add( m ) );

		} else {

			materialSet.add( mesh.material );

		}

	}

	const materials = Array.from( materialSet );
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		// ensure the matrix world is up to date
		const mesh = meshes[ i ];
		if ( mesh.visible === false ) continue;

		mesh.updateMatrixWorld();

		// apply the matrix world to the geometry
		const originalGeometry = meshes[ i ].geometry;
		const geometry = options.cloneGeometry ? originalGeometry.clone() : originalGeometry;
		geometry.applyMatrix4( mesh.matrixWorld );

		// ensure our geometry has common attributes
		setCommonAttributes( geometry, {
			attributes: options.attributes,
			normalMapRequired: ! ! mesh.material.normalMap,
		} );
		trimToAttributes( geometry, options.attributes );

		// create the material index attribute
		const materialIndexAttribute = getGroupMaterialIndicesAttribute( geometry, mesh.material, materials );
		geometry.setAttribute( 'materialIndex', materialIndexAttribute );

		transformedGeometry.push( geometry );

	}

	const textureSet = new Set();
	materials.forEach( material => {

		for ( const key in material ) {

			const value = material[ key ];
			if ( value && value.isTexture ) {

				textureSet.add( value );

			}

		}

	} );

	const geometry = mergeBufferGeometries( transformedGeometry, false );
	const textures = Array.from( textureSet );
	return { geometry, materials, textures };

}
