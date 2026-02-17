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
			attributes = [ 'position', 'uv0' ],
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

	}

	update() {

		const { attributes, name } = this;

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

		// TODO: gather the BVHs, geometries, and meshes
		// TODO: handle the case where an "ObjectBVH" vs "MeshBVH" are passed
		// TODO: handle batched / instanced meshes
		const bvhs = [];
		const geometries = [];
		const meshes = [];

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

		function appendGeometryData( geometry ) {

			// TODO: handle "indirect" case
			if ( geometry.index ) {

				// TODO: need to handle the "sub range" case? For Batched Mesh?
				for ( let i = 0, l = geometry.index.count; i < l; i ++ ) {

					indexBuffer[ i + indexOffset ] = geometry.index.getX() + attributesOffset;

				}

				indexOffset += geometry.index.count;

			} else {

				for ( let i = 0, l = geometry.attributes.position.count; i < l; i ++ ) {

					indexBuffer[ i + indexOffset ] = i + attributesOffset;

				}

				indexOffset += geometry.attributes.position.count;

			}

			attributes.forEach( ( key, ai ) => {

				const attr = geometry.attributes[ key ];
				if ( ! attr ) {

					if ( key === 'color' ) {

						_vec.set( 1, 1, 1, 1 );

					} else {

						_vec.set( 0, 0, 0, 1 );

					}

				} else {

					_vec.fromBufferAttribute( attr, i );
					switch ( attr.itemSize ) {

					case 3:
						_vec.w = 0;
					case 2:
						_vec.z = 0;
					case 1:
						_vec.y = 0;

					}

				}

				_vec.toArray( attributesBuffer, attributesOffset * attributesStructSize + ai * 4 );

			} );

			attributesOffset += geometry.attributes.position.count;

		}

	}

}
