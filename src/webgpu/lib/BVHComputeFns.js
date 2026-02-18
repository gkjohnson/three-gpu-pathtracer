import { Matrix4, Vector4 } from 'three';
import { StorageBufferAttribute } from 'three/src/Three.WebGPU.Nodes.js';
import { wgsl, wgslFn } from 'three/tsl';
import { intersectTriangles, intersectsBounds } from 'three-mesh-bvh/webgpu';

// TODO: separate update functions into utilities
// TODO: add ability to easily update a single matrix / scene rearrangement
// TODO: add material support w/ function to easily update material
// TODO: add skinned mesh bvh support
// TODO: add overrideable functions for custom implementations (custom attributes, transform fields)
const _vec = /* @__PURE__ */ new Vector4();

export const constants = wgsl( /* wgsl */`
	const BVH_STACK_DEPTH = 60u;
	const INFINITY = 1e20;
	const TRI_INTERSECT_EPSILON = 1e-5;
` );

export const rayStruct = wgsl( /* wgsl */`
	struct Ray {
		origin: vec3f,
		_alignment0: u32,

		direction: vec3f,
		_alignment1: u32,
	};
` );

export const bvhNodeBoundsStruct = wgsl( /* wgsl */`
	struct BVHBoundingBox {
		min: array<f32, 3>,
		max: array<f32, 3>,
	}
` );

export const bvhNodeStruct = wgsl( /* wgsl */`
	struct BVHNode {
		bounds: BVHBoundingBox,
		rightChildOrTriangleOffset: u32,
		splitAxisOrTriangleCount: u32,
	};
`, [ bvhNodeBoundsStruct ] );

export const intersectionResultStruct = wgsl( /* wgsl */`
	struct IntersectionResult {
		indices: vec4u,
		normal: vec3f,
		didHit: bool,
		barycoord: vec3f,
		side: f32,
		dist: f32,
	};
` );

export const transformStruct = wgsl( /* wgsl */`
	struct TransformStruct {
		matrixWorld: mat4x4f,
		nodeOffset: u32,
		_alignment0: u32,
		_alignment1: u32,
		_alignment2: u32,
	}
` );

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

export class BVHComputeFns {

	constructor( bvh, options = {} ) {

		const {
			name = 'bvh_',
			attributes = [ 'position', 'normal', 'uv0' ],
		} = options;

		this.name = name;
		this.attributes = attributes;

		this.bvh = bvh;
		this.storageBufferAttributes = {
			index: null,
			attributes: null,
			nodes: null,
			transforms: null,
		};

		this.attributesStruct = null;
		this.raycastFirstHitFn = null;

		this.getBVH = ( object, id = - 1 ) => {

			if ( object.isInstancedMesh ) {

				return object.geometry.boundsTree;

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( id );
				return object.boundsTrees[ geometryId ];

			} else {

				return object.geometry.boundsTree;

			}

		};

		this.update();

	}

	update() {

		const { attributes, name, bvh } = this;

		const bvhs = [];
		const geometries = [];
		const geometryOffsets = [];
		const transformBVHs = [];

		// accumulate the sizes of the bvh nodes buffer, number of objects, and geometry buffers
		let bvhNodesBufferLength = 0;
		let objectTransformsCount = 0;
		let indexBufferLength = 0;
		let attributesBufferLength = 0;
		bvhNodesBufferLength += bvh._roots.reduce( ( v, root ) => v + root.byteLength, 0 );
		bvh.primitiveBuffer.forEach( compositeId => {

			const object = bvh.getObjectFromId( compositeId );
			const instanceId = bvh.getInstanceFromId( compositeId );
			const meshBvh = this.getBVH( object, instanceId );

			// add a new transform for each bvh root
			objectTransformsCount += meshBvh._roots.length;

			// if we haven't added this bvh, yet
			if ( ! bvhs.includes( meshBvh ) ) {

				// increase the buffer size
				bvhs.push( meshBvh );
				bvhNodesBufferLength += meshBvh._roots.reduce( ( v, root ) => v + root.byteLength, 0 );

				// save the geometry info to write later and increment the buffer sizes
				const indirectBuffer = meshBvh._indirectBuffer || null;

				if ( object.isBatchedMesh ) {

					const geometryId = object.getGeometryIdAt( instanceId );
					const range = object.getGeometryRangeAt( geometryId );
					geometries.push( {
						geometry: object.geometry,
						range: range,
						indirectBuffer: indirectBuffer,
					} );

					indexBufferLength += range.indexCount === - 1 ? range.vertexCount : range.indexCount;
					attributesBufferLength += range.vertexCount;

				} else {

					const geometry = object.geometry;
					indexBufferLength += geometry.index ? geometry.index.count : geometry.attributes.position.count;
					attributesBufferLength += geometry.attributes.position.count;
					geometries.push( {
						geometry: object.geometry,
						range: undefined,
						indirectBuffer: indirectBuffer,
					} );

				}

			}

			// save the index of the bvh associated with this transform
			transformBVHs.push( bvhs.indexOf( meshBvh ) );

		} );

		// construct the attribute struct
		let attributesStructSize = 0;
		const attributeStructContent = attributes
			.map( key => {

				attributesStructSize += 4;
				return `${ key }: vec4f,`;

			} ).join( '\n' );

		// write the geometry buffer attributes
		let attributesOffset = 0;
		let indexOffset = 0;
		const indexBuffer = new Uint32Array( indexBufferLength );
		const attributesBuffer = new Float32Array( attributesBufferLength * attributes.length * 4 );
		geometries.forEach( ( { geometry, range, indirectBuffer } ) => {

			const offset = appendGeometryData( geometry, range, indirectBuffer );
			geometryOffsets.push( offset );

		} );

		// write the bvh data
		const nodeBuffer = new ArrayBuffer( bvhNodesBufferLength );
		const nodeBuffer16 = new Uint16Array( nodeBuffer );
		const nodeBuffer32 = new Uint32Array( nodeBuffer );
		const nodeBufferFloat = new Float32Array( nodeBuffer );
		const bvhNodeOffsets = [];
		let nodeWriteOffset = 0;
		appendBVHData( bvh, 0, true );
		bvhs.forEach( ( bvh, i ) => {

			bvhNodeOffsets.push( appendBVHData( bvh, geometryOffsets[ i ], false ) );

		} );

		// write the transforms
		// stride is 20 floats (80 bytes) to match WGSL struct alignment: mat4x4f (64) + u32 (4) + 12 bytes padding to align to 16
		const TRANSFORM_STRIDE = 20;
		let transformWriteOffset = 0;
		const transformArrayBuffer = new ArrayBuffer( TRANSFORM_STRIDE * 4 * objectTransformsCount );
		const transformBufferF32 = new Float32Array( transformArrayBuffer );
		const transformBufferU32 = new Uint32Array( transformArrayBuffer );
		bvh.primitiveBuffer.forEach( ( compositeId, i ) => {

			const matrix = new Matrix4();
			bvh.getObjectMatrix( compositeId, matrix );

			const objectBvh = bvhs[ transformBVHs[ i ] ];
			const bvhOffset = bvhNodeOffsets[ transformBVHs[ i ] ];
			objectBvh._roots.forEach( ( root, ri ) => {

				matrix.toArray( transformBufferF32, transformWriteOffset * TRANSFORM_STRIDE );
				transformBufferU32[ transformWriteOffset * TRANSFORM_STRIDE + 16 ] = bvhOffset[ ri ];
				transformWriteOffset ++;

			} );

		} );

		const attributeStruct = wgsl( /* wgsl */`
			struct ${ name }GeometryStruct {
				${ attributeStructContent }
			}
		` );

		this.storageBufferAttributes.transforms = new StorageBufferAttribute( transformBufferF32, TRANSFORM_STRIDE );
		this.storageBufferAttributes.nodes = new StorageBufferAttribute( nodeBuffer32, 8 );
		this.storageBufferAttributes.index = new StorageBufferAttribute( indexBuffer, 1 );
		this.storageBufferAttributes.attributes = new StorageBufferAttribute( attributesBuffer, attributesStructSize );
		this.attributesStruct = attributeStruct;
		this.raycastFirstHitFn = wgslFn( /* wgsl */`
			fn ${ name }RaycastFirstHit( ray: Ray ) -> IntersectionResult {

			}
		`, [ intersectTriangles, intersectsBounds, rayStruct, bvhNodeStruct, intersectionResultStruct, constants ] );

		function appendBVHData( bvh, geometryOffsets, tlas = false ) {

			const BYTES_PER_NODE = 6 * 4 + 4 + 4;
			const UINT32_PER_NODE = BYTES_PER_NODE / 4;
			const IS_LEAFNODE_FLAG = 0xFFFF;
			const result = [];

			bvh._roots.forEach( ( root, rootIndex ) => {

				const rootBuffer16 = new Uint16Array( root );
				const rootBuffer32 = new Uint32Array( root );
				result.push( nodeWriteOffset );
				for ( let i = 0, l = root.byteLength / BYTES_PER_NODE; i < l; i ++ ) {

					const r32 = i * UINT32_PER_NODE;
					const r16 = r32 * 2;
					const n32 = nodeWriteOffset * UINT32_PER_NODE;
					const n16 = n32 * 2;

					// write bounds
					nodeBufferFloat.set( new Float32Array( root, i * BYTES_PER_NODE, 6 ), n32 );

					const isLeaf = IS_LEAFNODE_FLAG === rootBuffer16[ r16 + 15 ];
					if ( isLeaf ) {

						nodeBuffer16[ n16 + 14 ] = rootBuffer16[ r16 + 14 ];
						if ( tlas ) {

							// 0xFFFF == mesh leaf, 0xFF00 == TLAS leaf
							nodeBuffer32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
							nodeBuffer16[ n16 + 15 ] = 0xFF00;

						} else {

							nodeBuffer32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ] + geometryOffsets[ rootIndex ];
							nodeBuffer16[ n16 + 15 ] = IS_LEAFNODE_FLAG;

						}

					} else {

						nodeBuffer32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
						nodeBuffer32[ n32 + 7 ] = rootBuffer32[ r32 + 7 ];


					}

					nodeWriteOffset ++;

				}

			} );

			return result;

		}

		function appendGeometryData( geometry, offsets = null, indirectBuffer = null ) {

			const result = [];

			let vertexStart = 0;
			let vertexCount = geometry.attributes.position.count;
			if ( offsets ) {

				vertexStart = offsets.vertexStart;
				vertexCount = offsets.vertexCount;

			}

			// write indices — when an indirect buffer is present, dereference it to
			// resolve the BVH's triangle order into a flat index buffer
			result.push( indexOffset );

			if ( indirectBuffer ) {

				const dereferencedIndex = dereferenceIndex( geometry.index, indirectBuffer );
				for ( let i = 0; i < dereferencedIndex.length; i ++ ) {

					indexBuffer[ i + indexOffset ] = dereferencedIndex[ i ] - vertexStart + attributesOffset;

				}

				indexOffset += dereferencedIndex.length;

			} else if ( geometry.index ) {

				let indexStart = 0;
				let indexCount = geometry.index.count;
				if ( offsets ) {

					indexStart = offsets.indexStart;
					indexCount = offsets.indexCount;

				}

				for ( let i = 0; i < indexCount; i ++ ) {

					indexBuffer[ i + indexOffset ] = geometry.index.getX( i + indexStart ) - vertexStart + attributesOffset;

				}

				indexOffset += indexCount;

			} else {

				let indexStart = 0;
				let indexCount = geometry.attributes.position.count;
				if ( offsets ) {

					indexStart = offsets.vertexStart;
					indexCount = offsets.vertexCount;

				}

				for ( let i = 0; i < indexCount; i ++ ) {

					indexBuffer[ i + indexOffset ] = i + indexStart + attributesOffset;

				}

				indexOffset += indexCount;

			}

			attributes.forEach( ( key, interleavedOffset ) => {

				const attr = geometry.attributes[ key ];
				for ( let i = 0; i < vertexCount; i ++ ) {

					if ( ! attr ) {

						if ( key === 'color' ) {

							_vec.set( 1, 1, 1, 1 );

						} else {

							_vec.set( 0, 0, 0, 1 );

						}

					} else {

						_vec.fromBufferAttribute( attr, i + vertexStart );
						switch ( attr.itemSize ) {

						case 1:
							_vec.y = 0;
							_vec.z = 0;
							_vec.w = 0;
							break;
						case 2:
							_vec.z = 0;
							_vec.w = 0;
							break;
						case 3:
							_vec.w = 0;
							break;

						}

					}

					_vec.toArray( attributesBuffer, ( attributesOffset + i ) * attributesStructSize + interleavedOffset * 4 );

				}

			} );

			attributesOffset += vertexCount;
			return result;

		}

	}

}
