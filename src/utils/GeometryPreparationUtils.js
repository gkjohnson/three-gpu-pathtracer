import { BufferAttribute } from 'three';
import { mergeBufferGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function getGroupMaterialIndicesAttribute( geometry, materials, allMaterials ) {

	if ( ! Array.isArray( materials ) ) {

		materials = [ materials ];

	}

	const vertCount = geometry.attributes.position.count;
	const materialArray = new Uint8Array( vertCount );
	let groups = geometry.groups;
	if ( groups.length === 0 ) {

		groups = [ { count: vertCount, start: 0, materialIndex: 0 } ];

	}

	for ( let i = 0; i < groups.length; i ++ ) {

		const group = groups[ i ];
		const { count, start } = group;
		const endCount = Math.min( count, vertCount - start );
		const mat = materials[ group.materialIndex ];
		const materialIndex = allMaterials.indexOf( mat );

		for ( let j = 0; j < endCount; j ++ ) {

			materialArray[ start + j ] = materialIndex;

		}

	}

	return new BufferAttribute( materialArray, 1, false );

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
		let geometry = options.cloneGeometry ? originalGeometry.clone() : originalGeometry;
		geometry.applyMatrix4( mesh.matrixWorld );

		const attrs = options.attributes;
		if ( ! geometry.attributes.normal && ( attrs && attrs.includes( 'normal' ) ) ) {

			geometry.computeVertexNormals();

		}

		if ( ! geometry.attributes.uv && ( attrs && attrs.includes( 'uv' ) ) ) {

			const vertCount = geometry.attributes.position.count;
			geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( vertCount * 2 ), 2, false ) );

		}

		if ( ! geometry.attributes.tangent && ( attrs && attrs.includes( 'tangent' ) ) ) {

			if ( mesh.material.normalMap ) {

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

		// trim any unneeded attributes
		if ( options.attributes ) {

			for ( const key in geometry.attributes ) {

				if ( ! options.attributes.includes( key ) ) {

					geometry.deleteAttribute( key );

				}

			}

		}

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
