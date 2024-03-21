import { BufferAttribute } from 'three';

export function updateMaterialIndexAttribute( geometry, materials, allMaterials ) {

	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	const vertCount = posAttr.count;
	const totalCount = indexAttr ? indexAttr.count : vertCount;
	let groups = geometry.groups;
	if ( groups.length === 0 ) {

		groups = [ { count: totalCount, start: 0, materialIndex: 0 } ];

	}

	let materialIndexAttribute = geometry.getAttribute( 'materialIndex' );
	if ( ! materialIndexAttribute || materialIndexAttribute.count !== vertCount ) {

		// use an array with the minimum precision required to store all material id references.
		let array;
		if ( allMaterials.length <= 255 ) {

			array = new Uint8Array( vertCount );

		} else {

			array = new Uint16Array( vertCount );

		}

		materialIndexAttribute = new BufferAttribute( array, 1, false );
		geometry.deleteAttribute( 'materialIndex' );
		geometry.setAttribute( 'materialIndex', materialIndexAttribute );

	}

	const materialArray = materialIndexAttribute.array;
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

}

export function setCommonAttributes( geometry, attributes ) {

	if ( ! geometry.index ) {

		// TODO: compute a typed array
		const indexCount = geometry.attributes.position.count;
		const array = new Array( indexCount );
		for ( let i = 0; i < indexCount; i ++ ) {

			array[ i ] = i;

		}

		geometry.setIndex( array );

	}

	if ( ! geometry.attributes.normal && ( attributes && attributes.includes( 'normal' ) ) ) {

		geometry.computeVertexNormals();

	}

	if ( ! geometry.attributes.uv && ( attributes && attributes.includes( 'uv' ) ) ) {

		const vertCount = geometry.attributes.position.count;
		geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( vertCount * 2 ), 2, false ) );

	}

	if ( ! geometry.attributes.uv2 && ( attributes && attributes.includes( 'uv2' ) ) ) {

		const vertCount = geometry.attributes.position.count;
		geometry.setAttribute( 'uv2', new BufferAttribute( new Float32Array( vertCount * 2 ), 2, false ) );

	}

	if ( ! geometry.attributes.tangent && ( attributes && attributes.includes( 'tangent' ) ) ) {

		// compute tangents requires a uv and normal buffer
		if ( geometry.attributes.uv && geometry.attributes.normal ) {

			geometry.computeTangents();

		} else {

			const vertCount = geometry.attributes.position.count;
			geometry.setAttribute( 'tangent', new BufferAttribute( new Float32Array( vertCount * 4 ), 4, false ) );

		}

	}

	if ( ! geometry.attributes.color && ( attributes && attributes.includes( 'color' ) ) ) {

		const vertCount = geometry.attributes.position.count;
		const array = new Float32Array( vertCount * 4 );
		array.fill( 1.0 );
		geometry.setAttribute( 'color', new BufferAttribute( array, 4 ) );

	}

}
