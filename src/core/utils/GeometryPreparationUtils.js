import { BufferAttribute } from 'three';

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
