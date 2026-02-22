import { Matrix4, Vector4 } from 'three';
import { StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage } from 'three/tsl';
import {
	intersectsBounds,
	constants,
} from './wgsl/common.wgsl.js';
import {
	rayStruct,
	bvhNodeStruct,
} from './wgsl/structs.wgsl.js';
import { wgslTagFn } from './nodes/WGSLTagFnNode.js';

const BYTES_PER_NODE = 6 * 4 + 4 + 4;
const UINT32_PER_NODE = BYTES_PER_NODE / 4;
const IS_LEAFNODE_FLAG = 0xFFFF;

// TODO: add ability to easily update a single matrix / scene rearrangement (partial update)
// TODO: add material support w/ function to easily update material
// 		- add a callback for writing a property for a geometry to a range
// TODO: add skinned mesh bvh support
// TODO: see if we can reference wgslFn names directly rather than constructing them inline over and over
// and / or use local variable definitions for the pointers to clean up the code
// TODO: see if there's a "build" step that can be leveraged for nodes to make integration more simple
// TODO: allow for "slotting" a new type of callback (eg distance, etc) so multiple types of queries can be made
// 		- add a "shapecast" style function with functions and return types that can be slotted in

const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();

function dereferenceIndex( indexAttr, indirectBuffer ) {

	const indexArray = indexAttr ? indexAttr.array : null;
	const result = new Uint32Array( indirectBuffer.length * 3 );
	for ( let i = 0, l = indirectBuffer.length; i < l; i ++ ) {

		const i3 = 3 * i;
		const v3 = 3 * indirectBuffer[ i ];
		for ( let c = 0; c < 3; c ++ ) {

			result[ i3 + c ] = indexArray ? indexArray[ v3 + c ] : v3 + c;

		}

	}

	return result;

}

function getTotalBVHByteLength( bvh ) {

	return bvh._roots.reduce( ( v, root ) => v + root.byteLength, 0 );

}

// stride is 36 floats (144 bytes) to match WGSL struct alignment:
// mat4x4f (64) + mat4x4f (64) + u32 (4) + 12 bytes padding to align to 16
const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
	_alignment2: 'uint',
}, 'TransformStruct' );

const intersectionResultStruct = new StructTypeNode( {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	side: 'float',
	dist: 'float',
}, 'IntersectionResult' );

const intersectsTriangle = wgslTagFn/* wgsl */ `
	// fn
	fn intersectsTriangle( ray: ${ rayStruct }, a: vec3f, b: vec3f, c: vec3f ) -> ${ intersectionResultStruct } {

		var TRI_INTERSECT_EPSILON = ${ constants.TRI_INTERSECT_EPSILON };
		var result: ${ intersectionResultStruct };
		result.didHit = false;

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = - dot( ray.direction, n );

		if ( abs( det ) < TRI_INTERSECT_EPSILON ) {

			return result;

		}

		let invdet = 1.0 / det;

		let AO = ray.origin - a;
		let DAO = cross( AO, ray.direction );

		let u = dot( edge2, DAO ) * invdet;
		let v = -dot( edge1, DAO ) * invdet;
		let t = dot( AO, n ) * invdet;

		let w = 1.0 - u - v;

		if ( u < - TRI_INTERSECT_EPSILON || v < - TRI_INTERSECT_EPSILON || w < - TRI_INTERSECT_EPSILON || t < TRI_INTERSECT_EPSILON ) {

			return result;

		}

		result.didHit = true;
		result.barycoord = vec3f( w, u, v );
		result.dist = t;
		result.side = sign( det );
		result.normal = result.side * normalize( n );

		return result;

	}
`;

function buildRaycastFirstHitFn( prefix, storage, structs ) {

	// TODO: reduce the redundancy between these functions - possibly using code snippets or
	// macro-expansion-style mechanisms?

	const { BVH_STACK_DEPTH, INFINITY } = constants;
	const geometryRaycastFirstHitFn = wgslTagFn/* wgsl */`
		// includes
		${ [ bvhNodeStruct, structs.attributes ] }

		// fn
		fn ${ prefix }RaycastFirstHit_blas( ray: ${ rayStruct }, rootNodeIndex: u32, bestDist: f32 ) -> ${ intersectionResultStruct } {

			var bestHit: ${ intersectionResultStruct };
			bestHit.didHit = false;
			bestHit.dist = bestDist;

			var pointer: i32 = 0;
			var stack: array<u32, ${ BVH_STACK_DEPTH }>;
			stack[ 0 ] = rootNodeIndex;

			loop {

				if ( pointer < 0 || pointer >= i32( ${ BVH_STACK_DEPTH } ) ) {

					break;

				}

				let nodeIndex = stack[ pointer ];
				let node = ${ storage.nodes }[ nodeIndex ];
				pointer = pointer - 1;

				var boundsHitDist: f32 = 0.0;
				if ( ! ${ intersectsBounds }( ray, node.bounds, &boundsHitDist ) || boundsHitDist > bestHit.dist ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					let triCount = infoX & 0x0000ffffu;
					let triOffset = infoY;

					for ( var ti = triOffset; ti < triOffset + triCount; ti = ti + 1u ) {

						let i0 = ${ storage.index }[ ti * 3u ];
						let i1 = ${ storage.index }[ ti * 3u + 1u ];
						let i2 = ${ storage.index }[ ti * 3u + 2u ];

						let a = ${ storage.attributes }[ i0 ].position.xyz;
						let b = ${ storage.attributes }[ i1 ].position.xyz;
						let c = ${ storage.attributes }[ i2 ].position.xyz;

						var triResult = ${ intersectsTriangle }( ray, a, b, c );

						if ( triResult.didHit && triResult.dist < bestHit.dist ) {

							bestHit = triResult;
							bestHit.indices = vec4u( i0, i1, i2, ti );

						}

					}

				} else {

					let leftIndex = nodeIndex + 1u;
					let splitAxis = infoX & 0x0000ffffu;
					let rightIndex = nodeIndex + infoY;

					let leftToRight = ray.direction[ splitAxis ] >= 0.0;
					let c1 = select( rightIndex, leftIndex, leftToRight );
					let c2 = select( leftIndex, rightIndex, leftToRight );

					pointer = pointer + 1;
					stack[ pointer ] = c2;

					pointer = pointer + 1;
					stack[ pointer ] = c1;

				}

			}

			return bestHit;

		}
	`;

	return wgslTagFn/* wgsl */`
		// includes
		${ [ rayStruct, bvhNodeStruct, constants, transformStruct ] }

		// fn
		fn ${ prefix }RaycastFirstHit( ray: Ray ) -> ${ intersectionResultStruct } {

			var bestHit: ${ intersectionResultStruct };
			bestHit.didHit = false;
			bestHit.dist = ${ INFINITY };

			var tlasPointer: i32 = 0;
			var tlasStack: array<u32, ${ BVH_STACK_DEPTH }>;
			tlasStack[ 0 ] = 0u;

			loop {

				if ( tlasPointer < 0 || tlasPointer >= i32( ${ BVH_STACK_DEPTH } ) ) {

					break;

				}

				let currNodeIndex = tlasStack[ tlasPointer ];
				let node = ${ storage.nodes }[ currNodeIndex ];
				tlasPointer = tlasPointer - 1;

				var boundsHitDist: f32 = 0.0;
				if ( ! ${ intersectsBounds }( ray, node.bounds, &boundsHitDist ) || boundsHitDist > bestHit.dist ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					let count = infoX & 0x0000ffffu;
					let offset = infoY;

					for ( var t = offset; t < offset + count; t = t + 1u ) {

						let transform = ${ storage.transforms }[ t ];

						// Transform ray into object local space
						var localRay: Ray;
						localRay.origin = ( transform.inverseMatrixWorld * vec4f( ray.origin, 1.0 ) ).xyz;
						localRay.direction = ( transform.inverseMatrixWorld * vec4f( ray.direction, 0.0 ) ).xyz;

						let blasHit = ${ geometryRaycastFirstHitFn( { ray: 'localRay', rootNodeIndex: 'transform.nodeOffset', bestDist: 'bestHit.dist' } ) };
						if ( blasHit.didHit && blasHit.dist < bestHit.dist ) {

							bestHit = blasHit;
							bestHit.objectIndex = t;

							// Transform normal to world space: normal matrix = transpose( inverse )
							bestHit.normal = normalize( ( transpose( transform.inverseMatrixWorld ) * vec4f( bestHit.normal, 0.0 ) ).xyz );

						}

					}

				} else {

					let leftIndex = currNodeIndex + 1u;
					let splitAxis = infoX & 0x0000ffffu;
					let rightIndex = currNodeIndex + infoY;

					let leftToRight = ray.direction[ splitAxis ] >= 0.0;
					let c1 = select( rightIndex, leftIndex, leftToRight );
					let c2 = select( leftIndex, rightIndex, leftToRight );

					tlasPointer = tlasPointer + 1;
					tlasStack[ tlasPointer ] = c2;

					tlasPointer = tlasPointer + 1;
					tlasStack[ tlasPointer ] = c1;

				}

			}

			return bestHit;

		}`;

}

export class BVHComputeData {

	constructor( bvh, options = {} ) {

		const {
			prefix = 'bvh_',
			attributes = { position: 'vec4f' },
		} = options;

		this.prefix = prefix;
		this.attributes = attributes;
		this.bvh = bvh;

		this.storage = {
			index: null,
			attributes: null,
			nodes: null,
			transforms: null,
		};

		this.structs = {
			transform: transformStruct,
			attributes: null,
		};

		this.fns = {
			raycastFirstHit: null,
		};

	}

	update() {

		const self = this;
		const { attributes, structs, prefix, bvh } = this;

		// collect the BVHs
		const bvhInfo = [];
		const transformInfo = [];

		// accumulate the sizes of the bvh nodes buffer, number of objects, and geometry buffers
		let bvhNodesBufferLength = getTotalBVHByteLength( bvh );
		let indexBufferLength = 0;
		let attributesBufferLength = 0;
		bvh.primitiveBuffer.forEach( compositeId => {

			const object = bvh.getObjectFromId( compositeId );
			const instanceId = bvh.getInstanceFromId( compositeId );
			const range = { start: 0, count: 0, vertexStart: 0, vertexCount: 0 };
			const primBvh = this.getBVH( object, instanceId, range );

			// if we haven't added this bvh, yet
			if ( ! bvhInfo.find( info => info.bvh === primBvh ) ) {

				// save the geometry info to write later and increment the buffer sizes
				const info = {
					index: bvhInfo.length,
					bvh: primBvh,
					range: range,

					bvhBufferOffsets: null,
					indexBufferOffset: null,

				};

				// increase the buffer sizes for bvh and geometry
				bvhNodesBufferLength += getTotalBVHByteLength( primBvh );
				indexBufferLength += info.range.count;
				attributesBufferLength += info.range.vertexCount;
				bvhInfo.push( info );

			}

			// save the index of the bvh associated with this transform
			const data = bvhInfo.find( info => primBvh === info.bvh );
			primBvh._roots.forEach( ( root, i ) => {

				transformInfo.push( {
					data,
					root: i,
					object,
					instanceId,
					compositeId,
				} );

			} );

		} );

		//

		// construct the attribute struct
		const attributeStruct = new StructTypeNode( attributes, `${ prefix }GeometryStruct` );

		// write the geometry buffer attributes & bvh data
		let attributesOffset = 0;
		let indexOffset = 0;
		let nodeWriteOffset = 0;
		const indexBuffer = new Uint32Array( indexBufferLength );
		const attributesBuffer = new ArrayBuffer( attributesBufferLength * attributeStruct.getLength() * 4 );
		const bvhNodesBuffer = new ArrayBuffer( bvhNodesBufferLength );

		// append TLAS data
		appendBVHData( bvh, 0, transformInfo, 0, bvhNodesBuffer, true );
		nodeWriteOffset += getTotalBVHByteLength( bvh ) / BYTES_PER_NODE;
		bvhInfo.forEach( info => {

			// append bvh data
			const bvhNodeOffsets = appendBVHData( info.bvh, indexOffset / 3, transformInfo, nodeWriteOffset, bvhNodesBuffer, false );
			info.bvhNodeOffsets = bvhNodeOffsets;

			// append geometry data
			appendIndexData( info.bvh, info.range, attributesOffset, indexOffset, indexBuffer );
			appendGeometryData( info.bvh, info.range, attributesOffset, attributesBuffer );
			info.indexBufferOffset = indexOffset;

			// step the write offsets forward
			indexOffset += info.range.count;
			attributesOffset += info.range.vertexCount;
			nodeWriteOffset += getTotalBVHByteLength( info.bvh ) / BYTES_PER_NODE;

		} );

		//

		// write the transforms
		const transformArrayBuffer = new ArrayBuffer( structs.transform.getLength() * transformInfo.length * 4 );
		transformInfo.forEach( ( info, i ) => {

			_inverseMatrix.copy( bvh.matrixWorld ).invert();
			this.writeTransformData( info, _inverseMatrix, i, transformArrayBuffer );

		} );

		//

		// set up the storage buffers
		const bvhNodesStorage = storage( new StorageBufferAttribute( new Uint32Array( bvhNodesBuffer ), 8 ), bvhNodeStruct.name ).toReadOnly().setName( `${ prefix }nodes` );
		const transformsStorage = storage( new StorageBufferAttribute( new Uint32Array( transformArrayBuffer ), structs.transform.getLength() ), structs.transform.name ).toReadOnly().setName( `${ prefix }transforms` );
		const indexStorage = storage( new StorageBufferAttribute( indexBuffer, 1 ), 'uint' ).toReadOnly().setName( `${ prefix }index` );
		const attributesStorage = storage( new StorageBufferAttribute( new Uint32Array( attributesBuffer ), attributeStruct.getLength() ), attributeStruct.name ).toReadOnly().setName( `${ prefix }attributes` );

		this.storage.transforms = transformsStorage;
		this.storage.nodes = bvhNodesStorage;
		this.storage.index = indexStorage;
		this.storage.attributes = attributesStorage;
		this.structs.attributes = attributeStruct;
		this.fns.raycastFirstHit = buildRaycastFirstHitFn( prefix, this.storage, this.structs );

		const interpolateBody = attributeStruct
			.membersLayout
			.map( ( { name } ) => {

				return `result.${ name } = a0.${ name } * barycoord.x + a1.${ name } * barycoord.y + a2.${ name } * barycoord.z;`;

			} ).join( '\n' );
		this.fns.sampleTrianglePoint = wgslTagFn/* wgsl */`
			// fn
			fn ${ prefix }sampleTrianglePoint( barycoord: vec3f, indices: vec3u ) -> ${ attributeStruct } {

				var result: ${ attributeStruct };
				var a0 = ${ attributesStorage }[ indices.x ];
				var a1 = ${ attributesStorage }[ indices.y ];
				var a2 = ${ attributesStorage }[ indices.z ];
				${ interpolateBody }
				return result;

			}
		`;

		function appendBVHData( bvh, geometryOffset, transformInfo, nodeWriteOffset, target, tlas = false ) {

			const targetU16 = new Uint16Array( target );
			const targetU32 = new Uint32Array( target );
			const targetF32 = new Float32Array( target );

			const result = [];
			let tlasOffset = 0;
			bvh._roots.forEach( root => {

				const rootBuffer16 = new Uint16Array( root );
				const rootBuffer32 = new Uint32Array( root );
				result.push( nodeWriteOffset );
				for ( let i = 0, l = root.byteLength / BYTES_PER_NODE; i < l; i ++ ) {

					const r32 = i * UINT32_PER_NODE;
					const r16 = r32 * 2;
					const n32 = nodeWriteOffset * UINT32_PER_NODE;
					const n16 = n32 * 2;

					// write bounds
					targetF32.set( new Float32Array( root, i * BYTES_PER_NODE, 6 ), n32 );

					const isLeaf = IS_LEAFNODE_FLAG === rootBuffer16[ r16 + 15 ];
					if ( isLeaf ) {

						if ( tlas ) {

							// 0xFFFF == mesh leaf, 0xFF00 == TLAS leaf
							targetU32[ n32 + 6 ] = tlasOffset;
							targetU16[ n16 + 15 ] = 0xFF00;

							const count = rootBuffer16[ r16 + 14 ];
							// const offset = rootBuffer32[ r32 + 6 ];

							// each root is expanded into a separate transform so we need to expand
							// the embedded offsets and counts.
							let rootsCount = 0;
							for ( let o = 0; o < count; o ++ ) {

								const roots = transformInfo[ tlasOffset ].data.bvh._roots.length;
								tlasOffset += roots;
								rootsCount += roots;

							}

							targetU16[ n16 + 14 ] = rootsCount;

						} else {

							targetU32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ] + geometryOffset;
							targetU16[ n16 + 14 ] = rootBuffer16[ r16 + 14 ];
							targetU16[ n16 + 15 ] = IS_LEAFNODE_FLAG;

						}

					} else {

						targetU32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
						targetU32[ n32 + 7 ] = rootBuffer32[ r32 + 7 ];

					}

					nodeWriteOffset ++;

				}

			} );

			return result;

		}

		function appendIndexData( bvh, range, valueOffset, writeOffset, target ) {

			const { geometry } = bvh;
			const { start, count, vertexStart } = range;
			if ( bvh.indirect ) {

				const dereferencedIndex = dereferenceIndex( geometry.index, bvh._indirectBuffer );
				for ( let i = 0; i < dereferencedIndex.length; i ++ ) {

					target[ i + writeOffset ] = dereferencedIndex[ i ] - vertexStart + valueOffset;

				}

				writeOffset += dereferencedIndex.length;

			} else if ( geometry.index ) {

				for ( let i = 0; i < count; i ++ ) {

					target[ i + writeOffset ] = geometry.index.getX( i + start ) - vertexStart + valueOffset;

				}

				writeOffset += count;

			} else {

				for ( let i = 0; i < count; i ++ ) {

					target[ i + writeOffset ] = i + start + valueOffset;

				}

				writeOffset += count;

			}

		}

		function appendGeometryData( bvh, range, writeOffset, target ) {

			// if "mesh" is present then it is assumed to be a SkinnedMeshBVH
			const { geometry, mesh = null } = bvh;
			const { vertexStart, vertexCount } = range;
			const attributesBufferF32 = new Float32Array( target );
			attributeStruct.membersLayout.forEach( ( { name }, interleavedOffset ) => {

				// TODO: we should be able to have access to memory layout offsets here via the struct
				// API but it's not currently available.
				const attr = geometry.attributes[ name ];
				self.getDefaultAttributeValue( name, _def );

				for ( let i = 0; i < vertexCount; i ++ ) {

					if ( attr ) {

						if ( name === 'position' && mesh ) {

							// TODO: normals and tangents need to be transformed here, as well
							mesh.getVertexPosition( i + vertexStart, _vec );

						} else {

							_vec.fromBufferAttribute( attr, i + vertexStart );

						}

						switch ( attr.itemSize ) {

						case 1:
							_vec.y = _def.y;
							_vec.z = _def.z;
							_vec.w = _def.w;
							break;
						case 2:
							_vec.z = _def.z;
							_vec.w = _def.w;
							break;
						case 3:
							_vec.w = _def.w;
							break;

						}

					} else {

						_vec.copy( _def );

					}

					_vec.toArray( attributesBufferF32, ( writeOffset + i ) * attributeStruct.getLength() + interleavedOffset * 4 );

				}

			} );

			writeOffset += vertexCount;

		}

	}

	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		const { structs } = this;
		const transformBufferF32 = new Float32Array( targetBuffer );
		const transformBufferU32 = new Uint32Array( targetBuffer );

		const { object, instanceId, root, data } = info;
		const { bvhNodeOffsets } = data;

		if ( object.isInstancedMesh || object.isBatchedMesh ) {

			object.getMatrixAt( instanceId, _matrix ).premultiply( object.matrixWorld );

		} else {

			_matrix.copy( object.matrixWorld );

		}

		_matrix.premultiply( premultiplyMatrix );
		_matrix.toArray( transformBufferF32, writeOffset * structs.transform.getLength() );

		_matrix.invert();
		_matrix.toArray( transformBufferF32, writeOffset * structs.transform.getLength() + 16 );

		transformBufferU32[ writeOffset * structs.transform.getLength() + 32 ] = bvhNodeOffsets[ root ];

	}

	getBVH( object, instanceId, rangeTarget ) {

		let bvh = null;
		if ( object.boundsTree ) {

			// TODO
			// this is a case where a mesh has morph targets and skinned meshes

		} else if ( object.isBatchedMesh ) {

			const geometryId = object.getGeometryIdAt( instanceId );
			const range = object.getGeometryRangeAt( geometryId );
			Object.assign( rangeTarget, range );
			bvh = object.boundsTrees[ geometryId ];

		} else {

			const geometry = object.geometry;
			rangeTarget.count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
			rangeTarget.vertexCount = geometry.attributes.position.count;
			bvh = object.geometry.boundsTree;

		}

		if ( ! bvh ) {

			throw new Error( 'BVHComputeData: BVH not found.' );

		}

		return bvh;

	}

	getDefaultAttributeValue( key, target ) {

		switch ( key ) {

		case 'position':
		case 'color':
			target.set( 1, 1, 1, 1 );
			break;

		default:
			target.set( 0, 0, 0, 0 );

		}

		return target;

	}

	dispose() {

		// TODO: dispose buffers

	}

}
