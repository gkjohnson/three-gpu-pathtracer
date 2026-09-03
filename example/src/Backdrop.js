import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshStandardMaterial } from 'three';

// A "cyclorama" backdrop - a seamless floor that sweeps up into a wall. The curve begins at the
// object origin with the floor extending toward +z and the wall rising behind.
export class Backdrop extends Mesh {

	constructor( options = {} ) {

		const {
			width = 5,
			depth = 2.5,
			curve = 1.6,
			height = 2,
			curvature = 4,
			segments = 128,
		} = options;

		super(
			createGeometry( width, depth, curve, height, curvature, segments ),
			// mid grey plastic, matching the floor of the Coffee Maker scene
			new MeshStandardMaterial( {
				color: 0xc6c6c6,
				roughness: 0.2,
				metalness: 0,
				side: DoubleSide,
			} ),
		);

	}

	dispose() {

		this.geometry.dispose();
		this.material.dispose();

	}

}

function createGeometry( width, depth, curve, height, curvature, segments ) {

	// the flat floor only needs its two edges, the rest of the rows describe the curve
	const profile = [[ depth, 0 ]];
	const scale = Math.exp( curvature ) - 1;
	for ( let i = 0; i <= segments; i ++ ) {

		// squaring the exponent leaves the curve tangent to the floor where the two meet
		const t = i / segments;
		profile.push( [ - t * curve, height * ( Math.exp( curvature * t * t ) - 1 ) / scale ] );

	}

	const rows = profile.length;
	const positions = new Float32Array( rows * 2 * 3 );
	const uvs = new Float32Array( rows * 2 * 2 );
	const indices = [];

	for ( let i = 0; i < rows; i ++ ) {

		const [ z, y ] = profile[ i ];
		for ( let j = 0; j < 2; j ++ ) {

			const index = 2 * i + j;
			positions[ 3 * index + 0 ] = ( j - 0.5 ) * width;
			positions[ 3 * index + 1 ] = y;
			positions[ 3 * index + 2 ] = z;

			uvs[ 2 * index + 0 ] = j;
			uvs[ 2 * index + 1 ] = i / ( rows - 1 );

		}

		if ( i < rows - 1 ) {

			const a = 2 * i;
			indices.push( a, a + 2, a + 1, a + 1, a + 2, a + 3 );

		}

	}

	const geometry = new BufferGeometry();
	geometry.setIndex( indices );
	geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( uvs, 2 ) );
	geometry.computeVertexNormals();

	return geometry;

}
