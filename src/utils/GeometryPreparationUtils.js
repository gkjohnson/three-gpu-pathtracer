import { BufferAttribute } from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function getGroupMaterialIndicesAttribute( geometry, indexOffset = 0 ) {

	const vertCount = geometry.attributes.position.count;
	const materialArray = new Uint8Array( vertCount );
	let groups = geometry.groups;
	if ( groups.length === 0 ) {

		groups = [ { count: vertCount, start: 0, materialIndex: 0 } ];

	}

	for ( let i = 0; i < groups.length; i ++ ) {

		const { count, start, materialIndex } = groups[ i ];
		const endCount = Math.min( count, vertCount - start );

		for ( let j = 0; j < endCount; j ++ ) {

			materialArray[ start + j ] = indexOffset + materialIndex;

		}

	}

	return new BufferAttribute( materialArray, 1, false );

}

export function mergeMeshes( meshes, options = {} ) {

	options = { attributes: null, cloneGeometry: true, ...options };

	const transformedGeometry = [];
	const materials = [];
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		// ensure the matrix world is up to date
		const mesh = meshes[ i ];
		mesh.updateMatrixWorld();

		// apply the matrix world to the geometry
		const originalGeometry = meshes[ i ].geometry;
		const geometry = options.cloneGeometry ? originalGeometry.clone() : originalGeometry;
		geometry.applyMatrix4( mesh.matrixWorld );

		const attrs = options.attributes;
		if ( ! geometry.attributes.normal && ( attrs && attrs.includes( 'normal' ) ) ) {

			geometry.computeVertexNormals();

		}

		if ( ! geometry.attributes.uv && ( attrs && attrs.includes( 'uv' ) ) ) {

			const vertCount = geometry.attributes.position.count;
			geometry.setAttribute( 'uv', new BufferAttribute( new Uint8Array( vertCount * 2 ), 2, true ) );

		}

		if ( ! geometry.attributes.tangent && ( attrs && attrs.includes( 'tangent' ) ) ) {

			geometry.computeTangents();

		}

		// trim any unneeded attributes
		if ( options.attributes ) {

			for ( const key in geometry.attributes ) {

				if ( ! options.attributes.includes( key ) ) {

					geometry.deleteAttribute( key );

				}

			}

		}

		// save any materials
		const materialOffset = materials.length;
		if ( Array.isArray( mesh.material ) ) {

			materials.push( ...mesh.material );

		} else {

			materials.push( mesh.material );

		}

		// create the material index attribute
		const materialIndexAttribute = getGroupMaterialIndicesAttribute( geometry, materialOffset );
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
