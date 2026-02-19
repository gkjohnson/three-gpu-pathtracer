import { Matrix4, Vector4 } from 'three';
import { CodeNode, StorageBufferAttribute } from 'three/webgpu';
import { storage, wgsl, wgslFn } from 'three/tsl';
import {
	intersectsBounds,
	rayStruct,
	bvhNodeStruct,
	constants,
} from 'three-mesh-bvh/webgpu';

const BYTES_PER_NODE = 6 * 4 + 4 + 4;
const UINT32_PER_NODE = BYTES_PER_NODE / 4;
const IS_LEAFNODE_FLAG = 0xFFFF;

// TODO: clean up "update" function, separate it into chunks
// TODO: separate update functions into utilities
// TODO: add ability to easily update a single matrix / scene rearrangement (partial update)
// TODO: add material support w/ function to easily update material
// 		- add a callback for writing a property for a geometry to a range
// TODO: add skinned mesh bvh support
// TODO: add overrideable functions for custom implementations (custom attributes, transform fields)
// TODO: see if it's possible to replace function contents and dependencies in-place so that
// a node fn can be updated without regenerating all other materials.
// TODO: see if we can reference wgslFn names directly rather than constructing them inline over and over
// and / or use local variable definitions for the pointers to clean up the code
// TODO: see if there's a "build" step that can be leveraged for nodes to make integration more simple
// TODO: allow for "slotting" a new type of callback (eg distance, etc) so multiple types of queries can be made
// 		- add a "shapecast" style function with functions and return types that can be slotted in
// NEXT: add support for custom transform fields

const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();

// a more structured "struct" node that bookkeeps the struct name, byte size
class WGSLStructNode extends CodeNode {

	get uintSize() {

		return this.byteSize / 4;

	}

	constructor( name, byteSize, fields, includes = [] ) {

		const content = Object
			.entries( fields )
			.map( ( [ name, type ] ) => {

				return `${ name }: ${ type },`;

			} ).join( '\n' );

		const code = /* wgsl */`
			struct ${ name } {
				${ content }
			}
		`;

		super( code, includes, 'wgsl' );
		this.name = name;
		this.byteSize = byteSize;

	}

}

const wgslStruct = ( ...args ) => new WGSLStructNode( ...args );

// stride is 36 floats (144 bytes) to match WGSL struct alignment:
// mat4x4f (64) + mat4x4f (64) + u32 (4) + 12 bytes padding to align to 16
const transformStruct = wgslStruct( 'TransformStruct', 36 * 4, {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'u32',
	_alignment0: 'u32',
	_alignment1: 'u32',
	_alignment2: 'u32',
} );

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

const intersectionResultStruct = wgslStruct( 'IntersectionResult', 16 * 4, {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'u32',
	side: 'f32',
	dist: 'f32',
} );

const intersectsTriangle = wgslFn( /* wgsl */ `

	fn intersectsTriangle( ray: Ray, a: vec3f, b: vec3f, c: vec3f ) -> IntersectionResult {

		var result: IntersectionResult;
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

`, [ rayStruct, intersectionResultStruct, constants ] );

function buildRaycastFirstHitFn( name, nodesStorage, transformsStorage, indexStorage, attributesStorage, attributeStruct, transformStruct ) {

	const geometryRaycastFirstHitFn = wgslFn( /* wgsl */`
		fn ${ name }RaycastGeometryFirstHit( ray: Ray, rootNodeIndex: u32, bestDist: f32 ) -> IntersectionResult {

			var bestHit: IntersectionResult;
			bestHit.didHit = false;
			bestHit.dist = bestDist;

			var pointer: i32 = 0;
			var stack: array<u32, BVH_STACK_DEPTH>;
			stack[ 0 ] = rootNodeIndex;

			loop {

				if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

					break;

				}

				let nodeIndex = stack[ pointer ];
				let node = ${ name }nodes.value[ nodeIndex ];
				pointer = pointer - 1;

				var boundsHitDist: f32 = 0.0;
				if ( ! intersectsBounds( ray, node.bounds, &boundsHitDist ) || boundsHitDist > bestHit.dist ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					let triCount = infoX & 0x0000ffffu;
					let triOffset = infoY;

					for ( var ti = triOffset; ti < triOffset + triCount; ti = ti + 1u ) {

						let i0 = ${ name }index.value[ ti * 3u ];
						let i1 = ${ name }index.value[ ti * 3u + 1u ];
						let i2 = ${ name }index.value[ ti * 3u + 2u ];

						let a = ${ name }attributes.value[ i0 ].position.xyz;
						let b = ${ name }attributes.value[ i1 ].position.xyz;
						let c = ${ name }attributes.value[ i2 ].position.xyz;

						var triResult = intersectsTriangle( ray, a, b, c );

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
	`, [
		nodesStorage, indexStorage, attributesStorage,
		intersectsTriangle, intersectsBounds,
		rayStruct, bvhNodeStruct, intersectionResultStruct, constants,
		attributeStruct,
	] );

	return wgslFn( /* wgsl */`
		fn ${ name }RaycastFirstHit( ray: Ray ) -> IntersectionResult {

			var bestHit: IntersectionResult;
			bestHit.didHit = false;
			bestHit.dist = INFINITY;

			var tlasPointer: i32 = 0;
			var tlasStack: array<u32, BVH_STACK_DEPTH>;
			tlasStack[ 0 ] = 0u;

			loop {

				if ( tlasPointer < 0 || tlasPointer >= i32( BVH_STACK_DEPTH ) ) {

					break;

				}

				let currNodeIndex = tlasStack[ tlasPointer ];
				let node = ${ name }nodes.value[ currNodeIndex ];
				tlasPointer = tlasPointer - 1;

				var boundsHitDist: f32 = 0.0;
				if ( ! intersectsBounds( ray, node.bounds, &boundsHitDist ) || boundsHitDist > bestHit.dist ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					let count = infoX & 0x0000ffffu;
					let offset = infoY;

					for ( var t = offset; t < offset + count; t = t + 1u ) {

						let transform = ${ name }transforms.value[ t ];

						// Transform ray into object local space
						var localRay: Ray;
						localRay.origin = ( transform.inverseMatrixWorld * vec4f( ray.origin, 1.0 ) ).xyz;
						localRay.direction = ( transform.inverseMatrixWorld * vec4f( ray.direction, 0.0 ) ).xyz;

						let blasHit = ${ name }RaycastGeometryFirstHit( localRay, transform.nodeOffset, bestHit.dist );
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

		}
	`, [
		geometryRaycastFirstHitFn,
		nodesStorage, transformsStorage,
		intersectsBounds,
		rayStruct, bvhNodeStruct, intersectionResultStruct, constants,
		transformStruct,
	] );

}

export class BVHComputeFns {

	constructor( bvh, options = {} ) {

		const {
			name = 'bvh_',
			attributes = [ 'position', 'normal', 'uv0' ],
		} = options;

		this.name = name;
		this.attributes = attributes;

		this.bvh = bvh;
		this.storage = {
			index: null,
			attributes: null,
			nodes: null,
			transforms: null,
		};

		this.structs = {
			attributes: null,
			transform: null,
			intersection: null,
		};

		this.fns = {
			raycastFirstHit: null,
		};

		this.update();

	}

	update() {

		const self = this;
		const { attributes, name, bvh } = this;

		// collect the BVHs
		const geometryInfo = [];
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
			if ( ! geometryInfo.find( info => info.bvh === primBvh ) ) {

				// save the geometry info to write later and increment the buffer sizes
				const info = {
					index: geometryInfo.length,
					bvh: primBvh,
					geometry: primBvh.geometry,
					range: range,

					bvhBufferOffsets: null,
					indexBufferOffset: null,

				};

				// increase the buffer sizes for bvh and geometry
				bvhNodesBufferLength += getTotalBVHByteLength( primBvh );
				indexBufferLength += info.range.count;
				attributesBufferLength += info.range.vertexCount;
				geometryInfo.push( info );

			}

			// save the index of the bvh associated with this transform
			primBvh._roots.forEach( ( root, i ) => {

				transformInfo.push( {
					data: geometryInfo.find( info => object.geometry === info.geometry ),
					root: i,
					object,
					instanceId,
					compositeId,
				} );

			} );

		} );

		//

		// construct the attribute struct
		const attributeStruct = wgslStruct(
			`${ name }GeometryStruct`,
			4 * 4 * attributes.length,
			attributes.reduce( ( o, key ) => ( { ...o, [ key ]: 'vec4f' } ), {} ),
		);

		// write the geometry buffer attributes & bvh data
		let attributesOffset = 0;
		let indexOffset = 0;
		let nodeWriteOffset = 0;
		const indexBuffer = new Uint32Array( indexBufferLength );
		const attributesBuffer = new ArrayBuffer( attributesBufferLength * attributes.length * 4 * 4 );
		const bvhNodesBuffer = new ArrayBuffer( bvhNodesBufferLength );

		// append TLAS data
		appendBVHData( bvh, 0, transformInfo, 0, bvhNodesBuffer, true );
		nodeWriteOffset += getTotalBVHByteLength( bvh ) / BYTES_PER_NODE;
		geometryInfo.forEach( info => {

			// append bvh data
			const bvhNodeOffsets = appendBVHData( info.bvh, indexOffset / 3, transformInfo, nodeWriteOffset, bvhNodesBuffer, false );
			info.bvhNodeOffsets = bvhNodeOffsets;

			// append geometry data
			appendIndexData( info.geometry, info.bvh._indirectBuffer, info.range, attributesOffset, indexOffset, indexBuffer );
			appendGeometryData( info.geometry, info.range, attributesOffset, attributesBuffer );
			info.indexBufferOffset = indexOffset;

			// step the write offsets forward
			indexOffset += info.range.count;
			attributesOffset += info.range.vertexCount;
			nodeWriteOffset += getTotalBVHByteLength( info.bvh ) / BYTES_PER_NODE;

		} );

		//

		// write the transforms
		const transformArrayBuffer = new ArrayBuffer( transformStruct.byteSize * transformInfo.length );
		transformInfo.forEach( ( info, i ) => {

			_inverseMatrix.copy( bvh.matrixWorld ).invert();
			this.writeTransformData( info, _inverseMatrix, i, transformArrayBuffer );

		} );

		//

		// set up the storage buffers
		const bvhNodesStorage = storage( new StorageBufferAttribute( new Uint32Array( bvhNodesBuffer ), 8 ), 'BVHNode' ).toReadOnly().setName( `${ name }nodes` );
		const transformsStorage = storage( new StorageBufferAttribute( new Uint32Array( transformArrayBuffer ), transformStruct.uintSize ), transformStruct.name ).toReadOnly().setName( `${ name }transforms` );
		const indexStorage = storage( new StorageBufferAttribute( indexBuffer, 1 ), 'uint' ).toReadOnly().setName( `${ name }index` );
		const attributesStorage = storage( new StorageBufferAttribute( new Uint32Array( attributesBuffer ), attributeStruct.uintSize ), attributeStruct.name ).toReadOnly().setName( `${ name }attributes` );

		this.storage.transforms = transformsStorage;
		this.storage.nodes = bvhNodesStorage;
		this.storage.index = indexStorage;
		this.structs.attributes = attributeStruct;
		this.structs.transform = transformStruct;
		this.structs.intersectionResult = intersectionResultStruct;
		this.fns.raycastFirstHit = buildRaycastFirstHitFn( name, bvhNodesStorage, transformsStorage, indexStorage, attributesStorage, attributeStruct, transformStruct );

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

							const count = rootBuffer16[ r16 + 14 ];
							const offset = rootBuffer32[ r32 + 6 ];

							// each root is expanded into a separate transform so we need to expand
							// the embedded offsets and counts.
							let rootsCount = 0;
							for ( let o = offset, l = offset + count; o < l; o ++ ) {

								rootsCount += transformInfo[ o ].data.bvh._roots.length;

							}

							// 0xFFFF == mesh leaf, 0xFF00 == TLAS leaf
							targetU32[ n32 + 6 ] = tlasOffset; // rootBuffer32[ r32 + 6 ];
							targetU16[ n16 + 14 ] = rootsCount; //rootBuffer16[ r16 + 14 ];
							targetU16[ n16 + 15 ] = 0xFF00;

							tlasOffset += rootsCount;

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

		function appendIndexData( geometry, indirectBuffer, range, valueOffset, writeOffset, target ) {

			const { start, count, vertexStart } = range;
			if ( indirectBuffer ) {

				const dereferencedIndex = dereferenceIndex( geometry.index, indirectBuffer );
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

		function appendGeometryData( geometry, range, writeOffset, target ) {

			const { vertexStart, vertexCount } = range;
			const attributesBufferF32 = new Float32Array( target );
			attributes.forEach( ( key, interleavedOffset ) => {

				const attr = geometry.attributes[ key ];
				self.getDefaultAttributeValue( key, _def );

				for ( let i = 0; i < vertexCount; i ++ ) {

					if ( attr ) {

						_vec.fromBufferAttribute( attr, i + vertexStart );

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

					_vec.toArray( attributesBufferF32, ( writeOffset + i ) * attributeStruct.uintSize + interleavedOffset * 4 );

				}

			} );

			writeOffset += vertexCount;

		}

	}

	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

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
		_matrix.toArray( transformBufferF32, writeOffset * transformStruct.uintSize );

		_matrix.invert();
		_matrix.toArray( transformBufferF32, writeOffset * transformStruct.uintSize + 16 );

		transformBufferU32[ writeOffset * transformStruct.uintSize + 32 ] = bvhNodeOffsets[ root ];

	}

	getBVH( object, instanceId, rangeTarget ) {

		if ( object.isBatchedMesh ) {

			const geometryId = object.getGeometryIdAt( instanceId );
			const range = object.getGeometryRangeAt( geometryId );
			Object.assign( rangeTarget, range );
			return object.boundsTrees[ geometryId ];

		} else {

			const geometry = object.geometry;
			rangeTarget.count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
			rangeTarget.vertexCount = geometry.attributes.position.count;
			return object.geometry.boundsTree;

		}

	}

	getDefaultAttributeValue( key, target ) {

		if ( key === 'color' ) {

			target.set( 1, 1, 1, 1 );

		} else {

			target.set( 0, 0, 0, 1 );

		}

	}

	dispose() {

		// TODO: dispose buffers

	}

}
