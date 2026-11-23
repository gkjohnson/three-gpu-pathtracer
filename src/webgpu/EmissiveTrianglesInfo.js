import { texture, uniform } from 'three/tsl';
import { Matrix4, Vector3, RGBAFormat, RGIntegerFormat, RGBAIntegerFormat, FloatType, UnsignedIntType } from 'three/webgpu';
import { BVH, CENTER } from 'three-mesh-bvh';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { LinearDataTexture } from './LinearDataTexture.js';
import { lightRecordStruct } from './nodes/structs.wgsl.js';
import { EMISSIVE_TRIANGLE_LIGHT_TYPE } from './nodes/lights.wgsl.js';
import { RECORD_VISIBLE_WORD, RECORD_MATERIAL_INDEX_WORD } from './nodes/PathtracerBVHComputeData.js';

// three-mesh-bvh's packed node: 8 words, the bounds' min and max, then the right child's offset from the node or
// the leaf's primitive offset, and the split axis or the leaf's primitive count and flag in two 16-bit halves
const BVH_NODE_WORDS = 8;
const BVH_LEAF_FLAG = 0xffff;

// The floats of a light tree node, two texels:
// - its bounds' min and its power
// - its bounds' max and its second child's node index, or -( triangle index + 1 ) for a leaf
// The first child follows its node. Indices are stored as floats, exact up to 2^24
const NODE_FLOATS = 8;

// the smallest squared distance the importance divides a node's power by
const IMPORTANCE_DISTANCE_EPSILON = 1e-20;

const _matrix = /* @__PURE__ */ new Matrix4();
const _a = /* @__PURE__ */ new Vector3();
const _b = /* @__PURE__ */ new Vector3();
const _c = /* @__PURE__ */ new Vector3();
const _edge1 = /* @__PURE__ */ new Vector3();
const _edge2 = /* @__PURE__ */ new Vector3();
const _cross = /* @__PURE__ */ new Vector3();

// The light tree over the emissive triangles, built by three-mesh-bvh with one triangle per leaf. Its primitive
// buffer holds the triangle indices, reordered into leaf order by the build
class LightTreeBVH extends BVH {

	constructor( bounds ) {

		super();

		const count = bounds.length / 6;
		this.bounds = bounds;
		this.primitiveBuffer = new Uint32Array( count ).map( ( v, i ) => i );
		this.primitiveBufferStride = 1;
		this.init( {
			// TODO: a split that accounts for the triangles' power may build a better tree. A power weighted SAH
			// was tried and was no better than CENTER over the Zero-Day and Bistro scenes
			strategy: CENTER,
			targetLeafSize: 1,
			_strictLeafSize: 1,
			maxDepth: Infinity,
			verbose: false,
		} );

	}

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length } ];

	}

	writePrimitiveBounds( i, target, offset ) {

		for ( let k = 0; k < 6; k ++ ) {

			target[ offset + k ] = this.bounds[ i * 6 + k ];

		}

	}

}

// The scene's emissive triangles, sampled as a light. A light tree picks a triangle for a point: each node holds
// the bounds and total power of the triangles under it, and the walk from the root picks each child by its power
// over its squared distance to the point, see LightBounds in pbrt-v4. Emissive maps color the sampled point but don't
// change which triangle is picked. Three textures hold the triangles:
// - "emissiveTree": the tree's nodes, two texels each, one leaf per triangle.
// - "emissiveTriangles": each triangle's object index, triangle index, leaf node and area.
// - "emissiveObjects": each object's first triangle in that list and its first triangle in the bvh, to find a
//   hit triangle's leaf.
export class EmissiveTrianglesInfo {

	constructor() {

		this.countNode = uniform( 0, 'uint' );
		this.treeTextureNode = texture( new LinearDataTexture( new Float32Array( NODE_FLOATS ), 4, RGBAFormat, FloatType ) ).setName( 'emissiveTree' );
		this.trianglesTextureNode = texture( new LinearDataTexture( new Uint32Array( 4 ), 4, RGBAIntegerFormat, UnsignedIntType ) ).setName( 'emissiveTriangles' );
		this.objectsTextureNode = texture( new LinearDataTexture( new Uint32Array( 2 ), 2, RGIntegerFormat, UnsignedIntType ) ).setName( 'emissiveObjects' );

		this._initFns();

	}

	// Rebuilds the triangles and their tree from the bvh data. Call when the scene, its materials or its
	// transforms change
	update( bvhData, shadingModel ) {

		const { storage: bvhStorage, structs } = bvhData;
		const geometryU32 = bvhStorage.geometry.proxyNode.value.array;
		const geometryF32 = new Float32Array( geometryU32.buffer, geometryU32.byteOffset, geometryU32.length );
		const recordsU32 = bvhStorage.objects.proxyNode.value.array;
		const recordsF32 = new Float32Array( recordsU32.buffer, recordsU32.byteOffset, recordsU32.length );
		const recordLength = structs.objectRecord.getLength();

		// the packed vertex stride and where the position sits in it, in words
		const { attributeLayout } = bvhData;
		const attributeStride = attributeLayout.stride;
		const positionOffset = attributeLayout.members.find( ( { name } ) => name === 'position' ).offset;

		// Every triangle of each emissive object, in order so a hit triangle's place in the list follows from its
		// object's first one: its object and triangle index, area, bounds and power for the tree. Triangles without
		// area are kept, with no power
		const allObjectInfo = bvhData.getAllObjectInfo();
		const triangles = [];
		const areas = [];
		const bounds = [];
		const powers = [];
		const objects = new Uint32Array( allObjectInfo.length * 2 );
		allObjectInfo.forEach( ( { objectIndex, indexOffset, attributesOffset, primitiveOffset, primitiveCount } ) => {

			// skip objects that are hidden or don't emit
			const recordOffset = objectIndex * recordLength;
			const material = shadingModel.materials[ recordsU32[ recordOffset + RECORD_MATERIAL_INDEX_WORD ] ];
			if ( recordsU32[ recordOffset + RECORD_VISIBLE_WORD ] === 0 || ! material || ! material.emissive ) {

				return;

			}

			const { r, g, b } = material.emissive;
			const luminance = ( 0.2126 * r + 0.7152 * g + 0.0722 * b ) * ( material.emissiveIntensity ?? 1 );
			if ( ! ( luminance > 0 ) ) {

				return;

			}

			// the object's first triangle in the list, plus one so zero means it doesn't emit, and its first triangle
			// in its geometry's packed index, which triangle indices count from
			objects[ objectIndex * 2 ] = areas.length + 1;
			objects[ objectIndex * 2 + 1 ] = primitiveOffset;

			_matrix.fromArray( recordsF32, recordOffset );
			for ( let t = primitiveOffset; t < primitiveOffset + primitiveCount; t ++ ) {

				const i0 = geometryU32[ indexOffset + t * 3 ];
				const i1 = geometryU32[ indexOffset + t * 3 + 1 ];
				const i2 = geometryU32[ indexOffset + t * 3 + 2 ];
				_a.fromArray( geometryF32, attributesOffset + i0 * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_b.fromArray( geometryF32, attributesOffset + i1 * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_c.fromArray( geometryF32, attributesOffset + i2 * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_cross.crossVectors( _edge1.subVectors( _b, _a ), _edge2.subVectors( _c, _a ) );
				const area = 0.5 * _cross.length();

				bounds.push(
					Math.min( _a.x, _b.x, _c.x ), Math.min( _a.y, _b.y, _c.y ), Math.min( _a.z, _b.z, _c.z ),
					Math.max( _a.x, _b.x, _c.x ), Math.max( _a.y, _b.y, _c.y ), Math.max( _a.z, _b.z, _c.z ),
				);
				powers.push( area * luminance );
				triangles.push( objectIndex, t );
				areas.push( area );

			}

		} );

		const count = areas.length;
		const { nodes, leafIndices } = this._buildTree( new Float32Array( bounds ), new Float32Array( powers ) );

		// each triangle's object index, triangle index, leaf node and area bits
		const triangleData = new Uint32Array( Math.max( count, 1 ) * 4 );
		const areaBits = new Uint32Array( new Float32Array( areas ).buffer );
		for ( let i = 0; i < count; i ++ ) {

			triangleData[ i * 4 ] = triangles[ i * 2 ];
			triangleData[ i * 4 + 1 ] = triangles[ i * 2 + 1 ];
			triangleData[ i * 4 + 2 ] = leafIndices[ i ];
			triangleData[ i * 4 + 3 ] = areaBits[ i ];

		}

		this.treeTextureNode.value.dispose();
		this.treeTextureNode.value = new LinearDataTexture( count > 0 ? nodes : new Float32Array( NODE_FLOATS ), 4, RGBAFormat, FloatType );
		this.trianglesTextureNode.value.dispose();
		this.trianglesTextureNode.value = new LinearDataTexture( triangleData, 4, RGBAIntegerFormat, UnsignedIntType );
		this.objectsTextureNode.value.dispose();
		this.objectsTextureNode.value = new LinearDataTexture( objects.length > 0 ? objects : new Uint32Array( 2 ), 2, RGIntegerFormat, UnsignedIntType );

		this.countNode.value = count;

	}

	// Builds the light tree over the triangles' bounds and powers with three-mesh-bvh, then writes its nodes in this
	// class's layout, in the same depth first order. Returns the nodes and each triangle's leaf node index
	// TODO: packing and walking the tree with BVHComputeData instead of this class needs per-node data (three-mesh-bvh#988)
	_buildTree( bounds, powers ) {

		const count = powers.length;
		const nodes = new Float32Array( Math.max( 2 * count - 1, 1 ) * NODE_FLOATS );
		const leafIndices = new Uint32Array( count );
		if ( count === 0 ) {

			return { nodes, leafIndices };

		}

		const tree = new LightTreeBVH( bounds );
		const root = tree._roots[ 0 ];
		const rootF32 = new Float32Array( root );
		const rootU32 = new Uint32Array( root );
		const rootU16 = new Uint16Array( root );

		// children follow their parent, so walking the nodes backward sums each node's power from its children
		for ( let node = root.byteLength / 4 / BVH_NODE_WORDS - 1; node >= 0; node -- ) {

			const node32 = node * BVH_NODE_WORDS;
			const base = node * NODE_FLOATS;
			for ( let k = 0; k < 3; k ++ ) {

				nodes[ base + k ] = rootF32[ node32 + k ];
				nodes[ base + 4 + k ] = rootF32[ node32 + 3 + k ];

			}

			if ( rootU16[ node32 * 2 + 15 ] === BVH_LEAF_FLAG ) {

				// a leaf holds one triangle
				const triangleIndex = tree.primitiveBuffer[ rootU32[ node32 + 6 ] ];
				nodes[ base + 3 ] = powers[ triangleIndex ];
				nodes[ base + 7 ] = - ( triangleIndex + 1 );
				leafIndices[ triangleIndex ] = node;

			} else {

				// the first child follows its node
				const second = node + rootU32[ node32 + 6 ];
				nodes[ base + 3 ] = nodes[ base + NODE_FLOATS + 3 ] + nodes[ second * NODE_FLOATS + 3 ];
				nodes[ base + 7 ] = second;

			}

		}

		return { nodes, leafIndices };

	}

	_initFns() {

		const { treeTextureNode, trianglesTextureNode, objectsTextureNode, countNode } = this;
		const objectsStorage = contextProxy( 'bvhData.storage.objects' );
		const getTriangleIndices = contextProxyFn( 'bvhData.fns.getTriangleIndices' );
		const getVertexPosition = contextProxyFn( 'bvhData.fns.getVertexPosition' );
		const getEmission = contextProxyFn( 'shadingModel.fns.getEmission' );

		// texel "texel", 0 or 1, of node "node"
		const readNodeFn = wgslTagFn/* wgsl */`
			fn readEmissiveNode( node: u32, texel: u32 ) -> vec4f {

				let i = node * 2u + texel;
				let width = textureDimensions( ${ treeTextureNode } ).x;
				return textureLoad( ${ treeTextureNode }, vec2u( i % width, i / width ), 0 );

			}
		`;

		// the info of triangle "listIndex" in the list: its object index, triangle index, leaf node and area bits
		const readTriangleInfoFn = wgslTagFn/* wgsl */`
			fn readEmissiveTriangleInfo( listIndex: u32 ) -> vec4u {

				let width = textureDimensions( ${ trianglesTextureNode } ).x;
				return textureLoad( ${ trianglesTextureNode }, vec2u( listIndex % width, listIndex / width ), 0 );

			}
		`;

		// How much light a node could send to "position": its power over the squared distance to its center, held at
		// least its radius squared so positions near or inside it don't dominate. A simpler LightBounds::Importance()
		// from pbrt-v4, without its emission cones
		this.getImportance = wgslTagFn/* wgsl */`
			fn getEmissiveNodeImportance( node: u32, position: vec3f ) -> f32 {

				let boundsMinPower = ${ readNodeFn }( node, 0u );
				let boundsMaxLink = ${ readNodeFn }( node, 1u );
				let boundsMin = boundsMinPower.xyz;
				let boundsMax = boundsMaxLink.xyz;
				let power = boundsMinPower.w;

				let offset = position - ( boundsMin + boundsMax ) * 0.5;
				let distSq = dot( offset, offset );
				let radiusSq = dot( boundsMax - boundsMin, boundsMax - boundsMin ) * 0.25;
				return power / max( max( distSq, radiusSq ), ${ IMPORTANCE_DISTANCE_EPSILON } );

			}
		`;

		// The chance of the walk picking the first child of "node" for "position", by the children's importance.
		// Negative when neither child can light the position
		const getFirstChildChanceFn = wgslTagFn/* wgsl */`
			fn getEmissiveFirstChildChance( node: u32, secondChild: u32, position: vec3f ) -> f32 {

				let firstImportance = ${ this.getImportance }( node + 1u, position );
				let secondImportance = ${ this.getImportance }( secondChild, position );
				let total = firstImportance + secondImportance;
				if ( total <= 0.0 ) {

					return - 1.0;

				}

				return firstImportance / total;

			}
		`;

		// Picks an emissive triangle by walking the tree with "ruv.x", and a point on it with "ruv.yz", and returns
		// the light from that point toward "position". The pdf is zero when the side facing "position" doesn't emit
		this.sample = wgslTagFn/* wgsl */`
			fn sampleEmissiveTriangle( position: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				var lightRec: ${ lightRecordStruct };

				// walk down the tree, picking each child by its chance and reusing the random number
				var node = 0u;
				var pickPdf = 1.0;
				var r = ruv.x;
				var link = ${ readNodeFn }( 0u, 1u ).w;
				while ( link >= 0.0 ) {

					let secondChild = u32( link );
					let firstChance = ${ getFirstChildChanceFn }( node, secondChild, position );
					if ( firstChance < 0.0 ) {

						return lightRec;

					}

					if ( r < firstChance ) {

						node = node + 1u;
						pickPdf *= firstChance;
						r = r / firstChance;

					} else {

						node = secondChild;
						pickPdf *= 1.0 - firstChance;
						r = ( r - firstChance ) / ( 1.0 - firstChance );

					}

					link = ${ readNodeFn }( node, 1u ).w;

				}

				// the picked triangle's object, material and world space vertices
				let triangleInfo = ${ readTriangleInfoFn }( u32( - link - 1.0 ) );
				let objectIndex = triangleInfo.x;
				let triangleIndex = triangleInfo.y;
				let area = bitcast<f32>( triangleInfo.w );
				let objectInfo = &${ objectsStorage }[ objectIndex ];

				let indices = ${ getTriangleIndices }( triangleIndex, objectInfo.indexOffset );
				let p0 = ( objectInfo.matrixWorld * vec4f( ${ getVertexPosition }( indices.x, objectInfo.attributesOffset ), 1.0 ) ).xyz;
				let p1 = ( objectInfo.matrixWorld * vec4f( ${ getVertexPosition }( indices.y, objectInfo.attributesOffset ), 1.0 ) ).xyz;
				let p2 = ( objectInfo.matrixWorld * vec4f( ${ getVertexPosition }( indices.z, objectInfo.attributesOffset ), 1.0 ) ).xyz;

				// a random point, uniform over the triangle's area
				let su = sqrt( ruv.y );
				let b0 = 1.0 - su;
				let b1 = ruv.z * su;
				let b2 = 1.0 - b0 - b1;
				let point = b0 * p0 + b1 * p1 + b2 * p2;

				let toLight = point - position;
				let distSq = dot( toLight, toLight );
				let triangleNormal = normalize( cross( p1 - p0, p2 - p0 ) );
				let direction = toLight * inverseSqrt( distSq );

				// the light the point emits from the side facing "position", from the shading model
				let cosLight = - dot( triangleNormal, direction );
				let side = select( - 1.0, 1.0, cosLight > 0.0 );
				let facing = abs( cosLight );
				let emission = ${ getEmission }( objectInfo.materialIndex, indices.x, indices.y, indices.z, objectInfo.attributesOffset, vec3f( b0, b1, b2 ), side );
				if ( distSq <= 0.0 || facing <= 0.0 || area <= 0.0 || all( emission == vec3f( 0.0 ) ) ) {

					return lightRec;

				}

				// the pdf over solid angle: the chance of picking the triangle times the chance of the point, one over
				// the triangle's area
				lightRec.dist = sqrt( distSq );
				lightRec.direction = direction;
				lightRec.emission = emission;
				lightRec.pdf = pickPdf / area * distSq / facing;
				lightRec.lightType = ${ EMISSIVE_TRIANGLE_LIGHT_TYPE };
				return lightRec;

			}
		`;

		// The pdf of "sampleEmissiveTriangle" picking "position" on an object's triangle facing "normal", as seen from
		// "origin". Zero when the object doesn't emit. Walks down the tree to the triangle's leaf, multiplying the
		// chances of each child on the way. Used to MIS weight emission that bsdf rays hit
		this.getPdf = wgslTagFn/* wgsl */`
			fn getEmissiveTrianglePdf( origin: vec3f, position: vec3f, normal: vec3f, objectIndex: u32, triangleIndex: u32 ) -> f32 {

				if ( ${ countNode } == 0u ) {

					return 0.0;

				}

				// the triangle's place in the list, from where its object's triangles start in the list, plus one, and in
				// the bvh
				let objectsWidth = textureDimensions( ${ objectsTextureNode } ).x;
				let objectRange = textureLoad( ${ objectsTextureNode }, vec2u( objectIndex % objectsWidth, objectIndex / objectsWidth ), 0 ).xy;
				let firstInList = objectRange.x;
				let firstInBvh = objectRange.y;
				if ( firstInList == 0u ) {

					return 0.0;

				}

				let triangleInfo = ${ readTriangleInfoFn }( firstInList - 1u + triangleIndex - firstInBvh );
				let leaf = triangleInfo.z;
				let area = bitcast<f32>( triangleInfo.w );

				let toHit = position - origin;
				let distSq = dot( toHit, toHit );
				let cosLight = abs( dot( normal, toHit ) ) * inverseSqrt( distSq );
				if ( area <= 0.0 || distSq <= 0.0 || cosLight <= 0.0 ) {

					return 0.0;

				}

				// walk down to the leaf the same way the sampling would have: the first child's nodes come before the
				// second child
				var node = 0u;
				var pickPdf = 1.0;
				while ( node != leaf ) {

					let secondChild = u32( ${ readNodeFn }( node, 1u ).w );
					let firstChance = ${ getFirstChildChanceFn }( node, secondChild, origin );
					if ( firstChance < 0.0 ) {

						return 0.0;

					}

					if ( leaf < secondChild ) {

						node = node + 1u;
						pickPdf *= firstChance;

					} else {

						node = secondChild;
						pickPdf *= 1.0 - firstChance;

					}

				}

				return pickPdf / area * distSq / cosLight;

			}
		`;

	}

	dispose() {

		this.treeTextureNode.value.dispose();
		this.trianglesTextureNode.value.dispose();
		this.objectsTextureNode.value.dispose();

	}

}
