import { Vector4 } from 'three';
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
		const meshes = [];
		const geometryOffsets = [];

		// TODO: find the total BVH node size first, then append BVH and geometry data
		let nodeLength = 0;
		let transformCount = 0;
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
					const offset = appendGeometryData( object.geometry, geometryInfo );
					geometryOffsets.push( offset );

				} else {

					const offset = appendGeometryData( object.geometry );
					geometryOffsets.push( offset );

				}


			}

		} );

		// TODO: build the bvh node buffers
		const nodeBuffer = new ArrayBuffer( nodeLength );
		const nodeBuffer16 = new Uint16Array( nodeBuffer );
		const nodeBuffer32 = new Uint32Array( nodeBuffer );
		const nodeBufferFloat = new Float32Array( nodeBuffer );
		const bvhNodeOffsets = [];
		const nodeWriteOffset = 0;
		appendBVHData( bvh, true, 0 );
		bvhs.forEach( ( bvh, i ) => {

			bvhNodeOffsets.push( appendBVHData( bvh, true, geometryOffsets[ i ] ) );

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


		// gather the size of the geometry and BVH buffers
		let indexLength = 0;
		let attributesLength = 0;
		geometries.forEach( ( _, i ) => {

			const geometry = geometries[ i ];
			indexLength += geometry.index ? geometry.index.count : geometry.attributes.position.count;
			attributesLength += geometry.attributes.position.count;

		} );

		// initialize the geometry attributes
		const attributesOffset = 0;
		const indexOffset = 0;
		const indexBuffer = new Uint32Array( indexLength );
		const attributesBuffer = new Float32Array( attributesLength );
		geometries.forEach( ( _, i ) => {

			// TODO: fill out based on bvh "sub range"
			const geometry = geometries[ i ];
			appendGeometryData( geometry );


		} );

		// TODO: fill out the BVH buffers accounting for geometry offsets

		this.storageBufferAttributes.index = new StorageBufferAttribute( indexBuffer, 1 );
		this.storageBufferAttributes.attributes = new StorageBufferAttribute( attributesBuffer, attributesStructSize );
		this.attributesStruct = attributeStruct;
		this.raycastFirstHitFn = wgslFn( /* wgsl */`
			fn ${ name }RaycastFirstHit( ray: Ray ) -> IntersectionResult {

			}
		`, [ intersectTriangles, intersectsBounds, rayStruct, bvhNodeStruct, intersectionResultStruct, constants ] );

		function appendBVHData( bvh, tlas = false, geometryOffset = 0 ) {

			const BYTES_PER_NODE = 6 * 4 + 4 + 4;
			const UINT32_PER_NODE = BYTES_PER_NODE / 4;
			const IS_LEAFNODE_FLAG = 0xFFFF;
			const LEAFNODE_MASK_32 = IS_LEAFNODE_FLAG << 16;
			const result = [];

			bvh._roots.forEach( root => {

				const rootBuffer16 = new Uint16Array( root );
				const rootBuffer32 = new Uint32Array( root );
				const rootBufferFloat = new Float32Array( root );
				result.push( nodeWriteOffset );
				for ( let i = 0, l = root.byteSize / BYTES_PER_NODE; i < l; i ++ ) {

					// write bounds
					nodeBufferFloat.set( new Float32Array( root, i * BYTES_PER_NODE, 6 ), nodeWriteOffset * UINT32_PER_NODE );

					// TODO: write remaining data
					// - leaf
					// - primitive leaf
					// - primitive offset
					// - primitive count
					// - child
					// - split

				}

			} );

			return result;

		}

		function appendGeometryData( geometry, offsets = {} ) {

			const result = indexOffset;

			// TODO: handle "indirect" case
			if ( geometry.index ) {

				let {
					indexCount = - 1,
					indexStart = - 1,
				} = offsets;

				if ( indexCount === - 1 ) {

					indexStart = 0;
					indexCount = geometry.index.count;

				}

				for ( let i = 0; i < indexCount; i ++ ) {

					indexBuffer[ i + indexOffset ] = geometry.index.getX( i - indexStart ) + attributesOffset;

				}

				indexOffset += indexCount;

			} else {

				const indexCount = geometry.attributes.position.count;
				for ( let i = 0; i < indexCount; i ++ ) {

					indexBuffer[ i + indexOffset ] = i + attributesOffset;

				}

				indexOffset += indexCount;

			}

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
