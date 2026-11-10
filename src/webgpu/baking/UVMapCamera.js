/** @import { Object3D } from 'three/webgpu' */
/** @import { WebGPUPathTracer } from '../WebGPUPathTracer.js' */
import { Camera, StructTypeNode } from 'three/webgpu';
import { texture } from 'three/tsl';
import { wgslTagFn, contextProxy } from 'three-mesh-bvh/webgpu';
import { UVTriangleIdTexture } from './UVTriangleIdTexture.js';

// random points tried within a texel before falling back to its center, as Cycles' bake does
const JITTER_ATTEMPTS = 10;

// the surface at a texel: its triangle and barycentric coordinates in the tracer's buffers, the
// transform slot, and the world position and face normal
export const texelSurfaceStruct = new StructTypeNode( {
	indices: 'vec3u',
	barycoord: 'vec3f',
	slot: 'uint',
	position: 'vec3f',
	faceNormal: 'vec3f',
}, 'TexelSurface' );

// barycentric coordinates of p in the 2d triangle abc
const uvBarycentric = wgslTagFn/* wgsl */`
	fn uvBarycentric( p: vec2f, a: vec2f, b: vec2f, c: vec2f ) -> vec3f {

		let v0 = b - a;
		let v1 = c - a;
		let v2 = p - a;
		let denom = v0.x * v1.y - v1.x * v0.y;
		let v = ( v2.x * v1.y - v1.x * v2.y ) / denom;
		let w = ( v0.x * v2.y - v2.x * v0.y ) / denom;
		return vec3f( 1.0 - v - w, v, w );

	}
`;

// a new pseudo random point in [ 0, 1 ) from the last one
const rehash2 = wgslTagFn/* wgsl */`
	fn rehash2( p: vec2f ) -> vec2f {

		var h = bitcast<vec2u>( p ) * 747796405u + 2891336453u;
		h = ( ( h >> ( ( h >> vec2u( 28u ) ) + 4u ) ) ^ h ) * 277803737u;
		h = ( h >> vec2u( 22u ) ) ^ h;
		return vec2f( h >> vec2u( 8u ) ) / 16777216.0;

	}
`;

/**
 * Base camera that starts each path at a texel of the meshes' shared "uv1" atlas instead of a pixel, so
 * the path tracer renders a map in uv space. Subclasses decide the ray from the texel's surface, such as
 * `AOMapCamera` and `LightmapCamera`.
 */
export class UVMapCamera extends Camera {

	/**
	 * @param {Object3D} root - A mesh or hierarchy whose indexed meshes share one "uv1" atlas, such as from
	 *   `UVUnwrapper`, in the scene given to the tracer.
	 */
	constructor( root ) {

		super();

		this.root = root;
		this.idTexture = new UVTriangleIdTexture();
		this._idTextureNode = texture( this.idTexture.texture ).setSampler( false );

	}

	getCameraRayFn() {

		// called by the tracer when the scene or size changes
		const update = pathTracer => {

			this._updateTriangleIds( pathTracer );
			return false;

		};

		return { fn: this._getCameraRayNode(), update };

	}

	dispose() {

		this.idTexture.dispose();

	}

	// returns the "getCameraRay" function, built on "_getTexelSurfaceNode"
	_getCameraRayNode() {

		throw new Error( 'UVMapCamera: "_getCameraRayNode" must be implemented.' );

	}

	// returns a "getTexelSurface( uv, surface ) -> bool" function finding the surface at the texel of
	// the uv, false if no triangle covers it
	_getTexelSurfaceNode() {

		const { _idTextureNode } = this;
		const index = contextProxy( 'bvhData.storage.index' );
		const attributes = contextProxy( 'bvhData.storage.attributes' );
		const transforms = contextProxy( 'bvhData.storage.transforms' );

		return wgslTagFn/* wgsl */`
			fn getTexelSurface( uvIn: vec2f, surface: ptr<function, ${ texelSurfaceStruct }> ) -> bool {

				// the tracer stores pixel rows flipped. The tracer keeps its jitter inside the pixel, so the floor
				// can't round into a neighboring texel, and the clamp keeps the last row in the texture
				let uv = vec2f( uvIn.x, 1.0 - uvIn.y );
				let dims = vec2f( textureDimensions( ${ _idTextureNode }, 0 ) );
				let texel = clamp( floor( uv * dims ), vec2f( 0.0 ), dims - 1.0 );
				let ids = textureLoad( ${ _idTextureNode }, vec2i( texel ), 0 );
				let id = i32( round( ids.r ) ) - 1;
				if ( id < 0 ) {

					return false;

				}

				let tri = u32( id );
				let i0 = ${ index }[ tri * 3u ];
				let i1 = ${ index }[ tri * 3u + 1u ];
				let i2 = ${ index }[ tri * 3u + 2u ];

				// the jittered uv can fall outside the triangle, so other random points in the texel are tried
				// before falling back to its center, as Cycles' bake does
				// TODO: look at options for sampling every triangle touching the texel instead of one, like
				// three.js' LightMapper. Rasterizing the ids with a new sub-texel jitter every frame would be a
				// fine compromise, even though a texel's samples then don't follow one sequence
				let t0 = ${ attributes }[ i0 ].uv1.xy;
				let t1 = ${ attributes }[ i1 ].uv1.xy;
				let t2 = ${ attributes }[ i2 ].uv1.xy;
				var bary = ${ uvBarycentric }( ( texel + 0.5 ) / dims, t0, t1, t2 );
				var offset = uv * dims - texel;
				for ( var i = 0; i < ${ JITTER_ATTEMPTS }; i ++ ) {

					let jittered = ${ uvBarycentric }( ( texel + offset ) / dims, t0, t1, t2 );
					if ( min( jittered.x, min( jittered.y, jittered.z ) ) >= 0.0 ) {

						bary = jittered;
						break;

					}

					offset = ${ rehash2 }( offset );

				}

				let slot = u32( round( ids.g ) );
				let objectInfo = ${ transforms }[ slot ];
				let p0 = ( objectInfo.matrixWorld * ${ attributes }[ i0 ].position ).xyz;
				let p1 = ( objectInfo.matrixWorld * ${ attributes }[ i1 ].position ).xyz;
				let p2 = ( objectInfo.matrixWorld * ${ attributes }[ i2 ].position ).xyz;

				// the triangle normal from its winding, since the vertex normals can bend past it on thin edges
				let faceNormal = normalize( cross( p1 - p0, p2 - p0 ) );

				surface.indices = vec3u( i0, i1, i2 );
				surface.barycoord = bary;
				surface.slot = slot;
				surface.position = p0 * bary.x + p1 * bary.y + p2 * bary.z;
				surface.faceNormal = faceNormal;
				return true;

			}
		`;

	}

	// renders the triangle ids of the meshes at the tracer's size
	_updateTriangleIds( pathTracer ) {

		const { x, y } = pathTracer._size;
		if ( x === 0 || y === 0 ) {

			return;

		}

		this.idTexture.setSize( x, y );

		// where the tracer packed the triangles of each geometry group
		const ranges = [];
		this.root.traverse( mesh => {

			if ( ! mesh.isMesh ) {

				return;

			}

			const { geometry } = mesh;
			const triangleCount = geometry.getIndex().count / 3;
			const groups = geometry.groups.length > 0 ? geometry.groups : [ { start: 0, count: Infinity } ];
			const { triangleOffset } = pathTracer.getObjectInfo( mesh );
			groups.forEach( ( group, i ) => {

				const start = group.start / 3;
				ranges.push( {
					triangleOffset: triangleOffset + start,
					count: Math.min( group.count / 3, triangleCount - start ),
					slot: pathTracer.getObjectInfo( mesh, 0, i ).slot,
				} );

			} );

		} );

		this.idTexture.update( pathTracer._renderer, pathTracer._bvhData.storage, ranges );

	}

}
