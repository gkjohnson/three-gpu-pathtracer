import { Matrix4, Vector4 } from 'three';
import { StorageBufferAttribute } from 'three/src/Three.WebGPU.Nodes.js';
import { wgsl, wgslFn } from 'three/tsl';
import { intersectTriangles, intersectsBounds } from 'three-mesh-bvh/webgpu';

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
	}
` );

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
		this.update();

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

	}

	update() {

		const { attributes, name, bvh } = this;

		// TODO: add support for materials? Optional? Custom callback?
		// TODO: gather the BVHs, geometries, and meshes
		// TODO: handle the case where an "ObjectBVH" vs "MeshBVH" are passed
		// TODO: handle batched / instanced meshes
		// TODO: how to handle skinned meshes?
		const bvhs = [];
		const geometries = [];
		const geometryOffsets = [];
		const transformBVHs = [];

		// TODO: find the total BVH node size first, then append BVH and geometry data
		let nodeLength = 0;
		let transformCount = 0;
		let indexLength = 0;
		let attributesLength = 0;
		nodeLength += bvh._roots[ 0 ].byteLength;
		bvh.primitiveBuffer.forEach( compositeId => {

			const object = bvh.getObjectFromId( compositeId );
			const instanceId = bvh.getInstanceFromId( compositeId );
			const bvh = this.getBVH( object, instanceId );
			transformCount += bvh._roots.length;

			if ( ! bvhs.includes( bvh ) ) {

				bvhs.push( bvh );
				nodeLength += bvh._roots.reduce( ( v, root ) => v + root.byteLength, 0 );

				// write associated geometry data, save offsets for use later
				if ( object.isBatchedMesh ) {

					const geometryId = object.getGeometryIdAt( instanceId );
					const geometryInfo = object.getGeometryRangeAt( geometryId );
					geometries.push( {
						geometry: object.geometry,
						range: geometryInfo,
					} );

					indexLength += range.indexCount === - 1 ? range.vertexCount : range.indexCount;
					attributesLength += range.vertexCount;

				} else {

					indexLength += geometry.index ? geometry.index.count : geometry.attributes.position.count;
					attributesLength += geometry.attributes.position.count;
					geometries.push( {
						geometry: object.geometry,
						range: undefined,
					} );

				}

			}

			transformBVHs.push( bvhs.indexOf( bvh ) );

		} );

		// initialize the geometry attributes
		const attributesOffset = 0;
		const indexOffset = 0;
		const indexBuffer = new Uint32Array( indexLength );
		const attributesBuffer = new Float32Array( attributesLength );
		geometries.forEach( ( { geometry, range } ) => {

			const offset = appendGeometryData( geometry, range );
			geometryOffsets.push( offset );

		} );

		const nodeBuffer = new ArrayBuffer( nodeLength );
		const nodeBuffer16 = new Uint16Array( nodeBuffer );
		const nodeBuffer32 = new Uint32Array( nodeBuffer );
		const nodeBufferFloat = new Float32Array( nodeBuffer );
		const bvhNodeOffsets = [];
		const nodeWriteOffset = 0;
		appendBVHData( bvh, 0, true );
		bvhs.forEach( ( bvh, i ) => {

			bvhNodeOffsets.push( appendBVHData( bvh, geometryOffsets[ i ] ), false );

		} );

		let transformWriteOffset = 0;
		const transformBuffer = new Uint32Array( 17 * transformCount );
		bvh.primitiveBuffer.forEach( ( compositeId, i ) => {

			const matrix = new Matrix4();
			bvh.getObjectMatrix( compositeId, matrix );

			const objectBvh = bvhs[ transformBVHs[ i ] ];
			const bvhOffset = bvhNodeOffsets[ i ];
			objectBvh._roots.forEach( ( root, ri ) => {

				matrix.toArray( transformBuffer, transformWriteOffset * 17 );
				transformBuffer[ transformWriteOffset * 17 + 16 ] = bvhOffset[ ri ];
				transformWriteOffset ++;

			} );

		} );

		// TODO: build the geometry and transforms


		// construct the attribute struct
		let attributesStructSize = 0;
		const attributeStructContent = attributes
			.map( key => {

				attributesStructSize += 16;
				return `${ key }: vec4,`;

			} ).join( '\n' );

		const attributeStruct = wgsl( /* wgsl */`
			struct ${ name }GeometryStruct {
				${ attributeStructContent }
			}
		` );

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
				for ( let i = 0, l = root.byteSize / BYTES_PER_NODE; i < l; i ++ ) {

					const r32 = i * UINT32_PER_NODE;
					const r16 = r32 * 2;
					const n32 = nodeWriteOffset * UINT32_PER_NODE;
					const n16 = n32 * 2;

					// write bounds
					nodeBufferFloat.set( new Float32Array( root, i * BYTES_PER_NODE, 6 ), n32 );

					const isLeaf = IS_LEAFNODE_FLAG === rootBuffer16[ r32 + 15 ];
					if ( isLeaf ) {

						nodeBuffer32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
						nodeBuffer16[ n16 + 14 ] = rootBuffer16[ r16 + 14 ] + geometryOffsets[ rootIndex ];
						if ( tlas ) {

							// 0xFFFF == mesh leaf, 0xFF00 == TLAS leaf
							nodeBuffer16[ n16 + 15 ] = 0xFF00;

						} else {

							nodeBuffer16[ n16 + 15 ] = IS_LEAFNODE_FLAG;

						}

					} else {

						nodeBuffer32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
						nodeBuffer32[ n32 + 7 ] = rootBuffer32[ r32 + 7 ];


					}

				}

			} );

			return result;

		}

		function appendGeometryData( geometry, offsets = {} ) {

			const result = [];
			const groups = geometry.groups.length === 0 ? [ { start: 0, count: Infinity } ] : geometry.groups;

			groups.forEach( group => {

				result.push( indexOffset );

				// TODO: handle "indirect" case
				// TODO: validate the write offsets here
				if ( geometry.index ) {

					let {
						indexCount = - 1,
						indexStart = - 1,
					} = offsets;

					if ( indexCount === - 1 ) {

						indexStart = 0;
						indexCount = geometry.index.count;

					}

					const indexEnd = Math.min( indexStart + indexCount, group.start + group.count );

					indexStart = Math.max( indexStart, group.start );
					indexCount = indexEnd - indexStart;

					for ( let i = 0; i < indexCount; i ++ ) {

						indexBuffer[ i + indexOffset ] = geometry.index.getX( i - indexStart ) + attributesOffset;

					}

					indexOffset += indexCount;

				} else {

					let {
						vertexStart = - 1,
						vertexCount = - 1,
					} = offsets;

					if ( vertexCount === - 1 ) {

						vertexStart = 0;
						vertexCount = geometry.attributes.position.count;

					}

					const indexStart = Math.max( vertexStart, group.start );
					const indexEnd = Math.min( group.start + group.end, vertexStart, vertexCount );
					const indexCount = indexEnd - indexStart;
					for ( let i = 0; i < indexCount; i ++ ) {

						indexBuffer[ i + indexOffset ] = i - indexStart + attributesOffset;

					}

					indexOffset += indexCount;

				}

			} );

			let {
				vertexStart = - 1,
				vertexCount = - 1,
			} = offsets;

			if ( vertexCount === - 1 ) {

				vertexStart = 0;
				vertexCount = geometry.attributes.position.count;

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

						_vec.fromBufferAttribute( attr, i - vertexStart );
						switch ( attr.itemSize ) {

						case 3:
							_vec.w = 0;
						case 2:
							_vec.z = 0;
						case 1:
							_vec.y = 0;

						}

					}

					_vec.toArray( attributesBuffer, attributesOffset * attributesStructSize + interleavedOffset * 4 );

				}

			} );

			attributesOffset += geometry.attributes.position.count;
			return result;

		}

	}

}
