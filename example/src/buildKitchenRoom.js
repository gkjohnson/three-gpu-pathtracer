import {
	Box3,
	ExtrudeGeometry,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	Path,
	Shape,
	ShapeGeometry,
	Vector2,
	Vector3,
} from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Builds the lightmap demo's room around the kitchen model: walls along the outline of its floor, from the floor's
// underside up to a ceiling just over the cabinets, and the ceiling the same shape. Every face points into the room,
// so the walls toward the camera are culled. The left wall has a window, its frame one piece flush with the wall.
// Adds the "Room" and "WindowFrame" meshes to the root.
export function buildKitchenRoom( root ) {

	root.updateMatrixWorld( true );

	let floorMesh = null;
	root.traverse( c => {

		if ( c.isMesh && c.material.name === 'Material.001' ) {

			floorMesh = c;

		}

	} );

	const bounds = new Box3().setFromObject( root );
	const outline = getFloorOutline( floorMesh );
	const floor = new Box3().setFromObject( floorMesh, true ).min.y;
	const ceiling = bounds.max.y + 0.01;

	// the outline's winding decides which side of each edge is inside
	let area = 0;
	outline.forEach( ( p, i ) => {

		const q = outline[ ( i + 1 ) % outline.length ];
		area += p.x * q.y - q.x * p.y;

	} );

	// each wall is one connected surface from the floor's underside to the ceiling, the left one with the window's
	// opening cut out of it, so the unwrapper keeps each as a single chart
	const up = new Vector3( 0, 1, 0 );
	const left = Math.min( ...outline.map( p => p.x ) );
	const height = ceiling - floor;
	const surfaces = [];
	let windowFrame = null;
	outline.forEach( ( p, i ) => {

		const q = outline[ ( i + 1 ) % outline.length ];
		const along = new Vector3( q.x - p.x, 0, q.y - p.y );
		const length = along.length();
		along.normalize();
		const inward = along.clone().cross( up ).multiplyScalar( area > 0 ? 1 : - 1 );
		const origin = new Vector3( p.x, floor, p.y );

		const shape = createRectangle( new Shape(), 0, 0, length, height );
		if ( Math.abs( p.x - left ) < 1e-3 && Math.abs( q.x - left ) < 1e-3 ) {

			// an 0.8 m square window, shifted toward the front of the wall, the +z side
			const center = ( ( p.y + q.y ) / 2 + 0.4 - p.y ) / along.z;
			const u0 = center - 0.4;
			const u1 = center + 0.4;
			const v0 = 0.95;
			const v1 = 1.75;
			shape.holes.push( createRectangle( new Path(), u0, v0, u1, v1 ) );

			// its frame: the opening less four panes, so the frame and its cross are one piece
			const frame = 0.05;
			const bar = 0.04;
			const depth = 0.02;
			const uCenter = ( u0 + u1 ) / 2;
			const vCenter = ( v0 + v1 ) / 2;
			const frameShape = createRectangle( new Shape(), u0, v0, u1, v1 );
			const columns = [
				[ u0 + frame, uCenter - bar / 2 ],
				[ uCenter + bar / 2, u1 - frame ],
			];
			const rows = [
				[ v0 + frame, vCenter - bar / 2 ],
				[ vCenter + bar / 2, v1 - frame ],
			];
			for ( const [ a0, a1 ] of columns ) {

				for ( const [ b0, b1 ] of rows ) {

					frameShape.holes.push( createRectangle( new Path(), a0, b0, a1, b1 ) );

				}

			}

			// flush with the wall and sticking into the room, without its back, which faces out of the room
			const frameGeometry = mapToPlane( new ExtrudeGeometry( frameShape, { depth, bevelEnabled: false } ), origin, along, up, inward );
			removeFacing( frameGeometry, inward.clone().negate() );
			windowFrame = new Mesh( frameGeometry, new MeshStandardMaterial( { name: 'WindowFrame', color: 0xf2efe9, roughness: 0.6 } ) );
			windowFrame.name = 'WindowFrame';

		}

		surfaces.push( mapToPlane( new ShapeGeometry( shape ), origin, along, up, inward ) );

	} );

	// the ceiling, the floor's outline facing down
	const ceilingShape = new Shape( outline.map( p => new Vector2( p.x, p.y ) ) );
	surfaces.push( mapToPlane( new ShapeGeometry( ceilingShape ), new Vector3( 0, ceiling, 0 ), new Vector3( 1, 0, 0 ), new Vector3( 0, 0, 1 ), new Vector3( 0, - 1, 0 ) ) );

	const room = new Mesh( mergeGeometries( surfaces ), new MeshStandardMaterial( { name: 'Room', color: 0xe8e4dc, roughness: 1 } ) );
	room.name = 'Room';
	root.add( room );
	if ( windowFrame ) {

		root.add( windowFrame );

	}

	root.updateMatrixWorld( true );

}

// adds a rectangle from ( x0, y0 ) to ( x1, y1 ) to a shape or path
function createRectangle( path, x0, y0, x1, y1 ) {

	return path.moveTo( x0, y0 ).lineTo( x1, y0 ).lineTo( x1, y1 ).lineTo( x0, y1 ).lineTo( x0, y0 );

}

// moves a geometry built in its own xy plane, with z its depth, onto a plane: x along "u", y along "v" and z along
// "n". The vertices are shared so connected faces stay connected, and the winding flips when the mapping mirrors
// so the faces that pointed along z point along "n"
function mapToPlane( geometry, origin, u, v, n ) {

	geometry.deleteAttribute( 'uv' );
	geometry.clearGroups();
	const result = mergeVertices( geometry );
	const matrix = new Matrix4().makeBasis( u, v, n ).setPosition( origin );
	result.applyMatrix4( matrix );

	if ( matrix.determinant() < 0 ) {

		const index = result.index;
		for ( let i = 0; i < index.count; i += 3 ) {

			const b = index.getX( i + 1 );
			index.setX( i + 1, index.getX( i + 2 ) );
			index.setX( i + 2, b );

		}

	}

	return result;

}

// removes an indexed geometry's triangles that face the given direction
function removeFacing( geometry, direction ) {

	const { index } = geometry;
	const position = geometry.attributes.position;
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	const kept = [];
	for ( let i = 0; i < index.count; i += 3 ) {

		a.fromBufferAttribute( position, index.getX( i ) );
		b.fromBufferAttribute( position, index.getX( i + 1 ) );
		c.fromBufferAttribute( position, index.getX( i + 2 ) );
		const normal = b.sub( a ).cross( c.sub( a ) ).normalize();
		if ( normal.dot( direction ) < 0.5 ) {

			kept.push( index.getX( i ), index.getX( i + 1 ), index.getX( i + 2 ) );

		}

	}

	geometry.setIndex( kept );

}

// the outline of a floor's top in world xz, from the edges its upward facing triangles don't share
function getFloorOutline( mesh ) {

	const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
	const position = geometry.attributes.position;
	const corners = [ new Vector3(), new Vector3(), new Vector3() ];
	const sideA = new Vector3();
	const sideB = new Vector3();
	const points = new Map();
	const edgeCounts = new Map();
	const getKey = v => `${ v.x.toFixed( 4 ) },${ v.z.toFixed( 4 ) }`;
	for ( let i = 0; i < position.count; i += 3 ) {

		corners.forEach( ( v, j ) => v.fromBufferAttribute( position, i + j ).applyMatrix4( mesh.matrixWorld ) );
		const normal = sideA.subVectors( corners[ 1 ], corners[ 0 ] ).cross( sideB.subVectors( corners[ 2 ], corners[ 0 ] ) ).normalize();
		if ( normal.y < 0.9 ) {

			continue;

		}

		const keys = corners.map( getKey );
		corners.forEach( ( v, j ) => points.set( keys[ j ], new Vector2( v.x, v.z ) ) );
		for ( let j = 0; j < 3; j ++ ) {

			const edgeKey = [ keys[ j ], keys[ ( j + 1 ) % 3 ] ].sort().join( '|' );
			edgeCounts.set( edgeKey, ( edgeCounts.get( edgeKey ) || 0 ) + 1 );

		}

	}

	// chain the unshared edges into one loop
	const neighbors = new Map();
	edgeCounts.forEach( ( count, edgeKey ) => {

		if ( count === 1 ) {

			const [ a, b ] = edgeKey.split( '|' );
			neighbors.set( a, [ ...( neighbors.get( a ) || [] ), b ] );
			neighbors.set( b, [ ...( neighbors.get( b ) || [] ), a ] );

		}

	} );

	const start = neighbors.keys().next().value;
	const loop = [ start ];
	let previous = null;
	let current = start;
	while ( true ) {

		const next = neighbors.get( current ).find( key => key !== previous );
		if ( next === start ) {

			break;

		}

		loop.push( next );
		previous = current;
		current = next;

	}

	// without the points partway along a straight edge, so each side of the floor is one wall
	const outline = loop.map( key => points.get( key ) );
	return outline.filter( ( p, i ) => {

		const previous = outline[ ( i + outline.length - 1 ) % outline.length ];
		const next = outline[ ( i + 1 ) % outline.length ];
		const cross = ( p.x - previous.x ) * ( next.y - p.y ) - ( p.y - previous.y ) * ( next.x - p.x );
		return Math.abs( cross ) > 1e-6;

	} );

}
