import { texture, uniform } from 'three/tsl';
import { Box3, RGBAFormat, RGIntegerFormat, RGBAIntegerFormat, FloatType, UnsignedIntType } from 'three/webgpu';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { LightTreeBVH } from './LightTreeBVH.js';
import { LinearDataTexture } from './LinearDataTexture.js';
import { lightRecordStruct, lightTreeNodeStruct, emissiveTriangleStruct } from './nodes/structs.wgsl.js';
import { EMISSIVE_TRIANGLE_LIGHT_TYPE, writeLightPointFn } from './nodes/lights.wgsl.js';
import { getLinearTexelFn } from './nodes/utils.wgsl.js';

// the smallest squared distance a node's power is divided by
const DISTANCE_EPSILON = 1e-20;

const _box = /* @__PURE__ */ new Box3();

// the luminance a material emits, without its emissive map
function getEmissiveLuminance( material ) {

	if ( ! material || ! material.emissive ) {

		return 0;

	}

	const { emissive, emissiveIntensity = 1 } = material;
	return ( 0.2126 * emissive.r + 0.7152 * emissive.g + 0.0722 * emissive.b ) * emissiveIntensity;

}

// The scene's emissive triangles, sampled as a light. They're kept in one list, in order of their objects, with a light
// tree over them. A triangle is picked for a position by walking the tree from its root, choosing each child by its
// power over its squared distance, see LightBounds in pbrt-v4. Emissive maps color the light but don't change which
// triangle is picked. Three textures hold the data:
// - "emissiveTree": the tree's nodes, two texels each, see LightTreeBVH
// - "emissiveTriangles": the list, each triangle's object index, triangle index in its object, leaf node and area
// - "emissiveObjects": where each object's triangles start in the list plus one, or zero if it doesn't emit, and the
//   triangle index they start at
// TODO: "emissiveObjects" could be one offset between the two in a spare word of the object records instead
export class EmissiveTrianglesInfo {

	constructor() {

		this.countNode = uniform( 0, 'uint' );
		this.treeNode = texture( new LinearDataTexture( new Float32Array( 0 ), 4, RGBAFormat, FloatType ) ).setName( 'emissiveTree' );
		this.trianglesNode = texture( new LinearDataTexture( new Uint32Array( 0 ), 4, RGBAIntegerFormat, UnsignedIntType ) ).setName( 'emissiveTriangles' );
		this.objectsNode = texture( new LinearDataTexture( new Uint32Array( 0 ), 2, RGIntegerFormat, UnsignedIntType ) ).setName( 'emissiveObjects' );

		this._initFns();

	}

	// Rebuilds the triangles and their tree from the bvh data. Call when the scene, its materials or its
	// transforms change
	// TODO: material changes only need a new tree when an object starts or stops emitting. Otherwise rewrite just the
	// powers, or nothing if the emission is unchanged
	update( bvhData ) {

		// no scene data has been written yet
		if ( bvhData.bvh === null ) {

			return;

		}

		// find the objects that emit and where their triangles start in the list
		const objectInfos = bvhData.getAllObjectInfo();
		const objects = new Uint32Array( objectInfos.length * 2 );
		const emissiveObjects = [];
		let count = 0;
		objectInfos.forEach( info => {

			const { objectIndex, primitiveOffset, primitiveCount } = info;
			const luminance = getEmissiveLuminance( bvhData.getRecordMaterial( objectIndex ) );
			if ( luminance > 0 ) {

				objects[ objectIndex * 2 ] = count + 1;
				objects[ objectIndex * 2 + 1 ] = primitiveOffset;
				emissiveObjects.push( { info, luminance } );
				count += primitiveCount;

			}

		} );

		// write the list. Triangles without area are kept, with no power
		const triangles = new Uint32Array( count * 4 );
		const triangleFloats = new Float32Array( triangles.buffer );
		const bounds = new Float32Array( count * 6 );
		const powers = new Float32Array( count );
		let index = 0;
		emissiveObjects.forEach( ( { info, luminance } ) => {

			bvhData.forEachTriangle( info, ( triangle, triangleIndex ) => {

				const area = triangle.getArea();
				triangles[ index * 4 ] = info.objectIndex;
				triangles[ index * 4 + 1 ] = triangleIndex;
				triangleFloats[ index * 4 + 3 ] = area;
				powers[ index ] = area * luminance;

				_box.makeEmpty().expandByPoint( triangle.a ).expandByPoint( triangle.b ).expandByPoint( triangle.c );
				_box.min.toArray( bounds, index * 6 );
				_box.max.toArray( bounds, index * 6 + 3 );
				index ++;

			} );

		} );

		// build the tree and write each triangle's leaf
		let nodes = new Float32Array( 0 );
		if ( count > 0 ) {

			const tree = new LightTreeBVH( bounds ).getNodes( powers );
			tree.triangleLeaves.forEach( ( leaf, i ) => triangles[ i * 4 + 2 ] = leaf );
			nodes = tree.nodes;

		}

		this.dispose();
		this.countNode.value = count;
		this.treeNode.value = new LinearDataTexture( nodes, 4, RGBAFormat, FloatType );
		this.trianglesNode.value = new LinearDataTexture( triangles, 4, RGBAIntegerFormat, UnsignedIntType );
		this.objectsNode.value = new LinearDataTexture( objects, 2, RGIntegerFormat, UnsignedIntType );

	}

	dispose() {

		this.treeNode.value.dispose();
		this.trianglesNode.value.dispose();
		this.objectsNode.value.dispose();

	}

	_initFns() {

		const { treeNode, trianglesNode, objectsNode, countNode } = this;
		const objectsStorage = contextProxy( 'bvhData.storage.objects' );
		const getTriangleIndices = contextProxyFn( 'bvhData.fns.getTriangleIndices' );
		const getVertexPosition = contextProxyFn( 'bvhData.fns.getVertexPosition' );
		const getHitEmission = contextProxyFn( 'shadingModel.fns.getHitEmission' );
		const getHitOpacity = contextProxyFn( 'shadingModel.fns.getHitOpacity' );

		const readNodeFn = wgslTagFn/* wgsl */`
			fn readLightTreeNode( index: u32 ) -> ${ lightTreeNodeStruct } {

				let width = textureDimensions( ${ treeNode } ).x;
				let minPower = textureLoad( ${ treeNode }, ${ getLinearTexelFn }( index * 2u, width ), 0 );
				let maxLink = textureLoad( ${ treeNode }, ${ getLinearTexelFn }( index * 2u + 1u, width ), 0 );

				var node: ${ lightTreeNodeStruct };
				node.boundsMin = minPower.xyz;
				node.boundsMax = maxLink.xyz;
				node.power = minPower.w;

				// the first child follows its node. A leaf's link is its place in the list, negative and minus one
				node.isLeaf = maxLink.w < 0.0;
				node.firstChild = index + 1u;
				node.secondChild = u32( max( maxLink.w, 0.0 ) );
				node.listIndex = u32( max( - maxLink.w - 1.0, 0.0 ) );
				return node;

			}
		`;

		const readTriangleFn = wgslTagFn/* wgsl */`
			fn readEmissiveTriangle( listIndex: u32 ) -> ${ emissiveTriangleStruct } {

				let width = textureDimensions( ${ trianglesNode } ).x;
				let data = textureLoad( ${ trianglesNode }, ${ getLinearTexelFn }( listIndex, width ), 0 );
				return ${ emissiveTriangleStruct }( data.x, data.y, data.z, bitcast<f32>( data.w ) );

			}
		`;

		// the place of an object's triangle in the list, or -1 if the object doesn't emit
		const getListIndexFn = wgslTagFn/* wgsl */`
			fn getEmissiveListIndex( objectIndex: u32, triangleIndex: u32 ) -> i32 {

				let width = textureDimensions( ${ objectsNode } ).x;
				let objectStart = vec2i( textureLoad( ${ objectsNode }, ${ getLinearTexelFn }( objectIndex, width ), 0 ).xy );
				let listStart = objectStart.x - 1;
				let triangleStart = objectStart.y;
				return select( listStart + i32( triangleIndex ) - triangleStart, - 1, listStart < 0 );

			}
		`;

		// How much light a node could send to "position": its power over the squared distance to its center, held at
		// least its radius squared so positions near or inside it don't dominate. A simpler LightBounds::Importance()
		// from pbrt-v4, without its emission cones
		const getImportanceFn = wgslTagFn/* wgsl */`
			fn getLightTreeNodeImportance( node: ${ lightTreeNodeStruct }, position: vec3f ) -> f32 {

				let toCenter = ( node.boundsMin + node.boundsMax ) * 0.5 - position;
				let size = node.boundsMax - node.boundsMin;
				let distSq = dot( toCenter, toCenter );
				let radiusSq = dot( size, size ) * 0.25;
				return node.power / max( max( distSq, radiusSq ), ${ DISTANCE_EPSILON } );

			}
		`;

		// the chance of the walk picking the first of two children, or -1 when neither can light the position
		const getFirstChildChanceFn = wgslTagFn/* wgsl */`
			fn getFirstChildChance( firstChild: ${ lightTreeNodeStruct }, secondChild: ${ lightTreeNodeStruct }, position: vec3f ) -> f32 {

				let firstImportance = ${ getImportanceFn }( firstChild, position );
				let secondImportance = ${ getImportanceFn }( secondChild, position );
				let total = firstImportance + secondImportance;
				if ( total <= 0.0 ) {

					return - 1.0;

				}

				return firstImportance / total;

			}
		`;

		// the estimated light at "position" from all the triangles, for weighing them against the lights
		this.getWeight = wgslTagFn/* wgsl */`
			fn getEmissiveWeight( position: vec3f ) -> f32 {

				if ( ${ countNode } == 0u ) {

					return 0.0;

				}

				return ${ getImportanceFn }( ${ readNodeFn }( 0u ), position );

			}
		`;

		// Picks an emissive triangle with "ruv.x" and a point on it with "ruv.yz", and returns the light from that point
		// toward "position". The pdf is zero when the side facing "position" doesn't emit
		this.sample = wgslTagFn/* wgsl */`
			fn sampleEmissiveTriangle( position: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				var lightRec: ${ lightRecordStruct };

				// walk down the tree to a leaf, rescaling the random number at each step to use it again
				var node = ${ readNodeFn }( 0u );
				var pickPdf = 1.0;
				var r = ruv.x;
				while ( ! node.isLeaf ) {

					let firstChild = ${ readNodeFn }( node.firstChild );
					let secondChild = ${ readNodeFn }( node.secondChild );
					let firstChance = ${ getFirstChildChanceFn }( firstChild, secondChild, position );
					if ( firstChance < 0.0 ) {

						return lightRec;

					}

					if ( r < firstChance ) {

						node = firstChild;
						pickPdf *= firstChance;
						r = r / firstChance;

					} else {

						node = secondChild;
						pickPdf *= 1.0 - firstChance;
						r = ( r - firstChance ) / ( 1.0 - firstChance );

					}

				}

				// the triangle
				let triangle = ${ readTriangleFn }( node.listIndex );
				let objectInfo = ${ objectsStorage }[ triangle.objectIndex ];
				let indices = ${ getTriangleIndices }( triangle.triangleIndex, objectInfo.indexOffset );
				let a = ${ getVertexPosition }( indices.x, objectInfo.attributesOffset );
				let b = ${ getVertexPosition }( indices.y, objectInfo.attributesOffset );
				let c = ${ getVertexPosition }( indices.z, objectInfo.attributesOffset );
				let normal = normalize( ( transpose( objectInfo.inverseMatrixWorld ) * vec4f( cross( b - a, c - a ), 0.0 ) ).xyz );

				// a point on it, uniform over its area
				let su = sqrt( ruv.y );
				let barycoord = vec3f( 1.0 - su, ruv.z * su, su - ruv.z * su );
				let localPoint = barycoord.x * a + barycoord.y * b + barycoord.z * c;
				let point = ( objectInfo.matrixWorld * vec4f( localPoint, 1.0 ) ).xyz;

				let toPosition = position - point;
				let distSq = dot( toPosition, toPosition );
				let cosLight = dot( normal, toPosition ) * inverseSqrt( distSq );
				let side = select( - 1.0, 1.0, cosLight > 0.0 );

				// the light from the side facing the position, less the share of rays that pass through it
				let opacity = ${ getHitOpacity }( objectInfo.materialIndex, objectInfo.color.a, indices, objectInfo.attributesOffset, barycoord, side );
				let emission = opacity * ${ getHitEmission }( objectInfo.materialIndex, indices, objectInfo.attributesOffset, barycoord, side );
				if ( triangle.area <= 0.0 || distSq <= 0.0 || cosLight == 0.0 || all( emission == vec3f( 0.0 ) ) ) {

					return lightRec;

				}

				// the chance of picking the triangle and then the point, over solid angle
				${ writeLightPointFn }( &lightRec, position, point, normal );
				lightRec.emission = emission;
				lightRec.pdf = pickPdf / triangle.area * distSq / abs( cosLight );
				lightRec.lightType = ${ EMISSIVE_TRIANGLE_LIGHT_TYPE };
				return lightRec;

			}
		`;

		// The pdf of "sampleEmissiveTriangle" picking "point" on an object's triangle facing "normal" for "position", to
		// MIS weight emission that bsdf rays hit. Zero when the object doesn't emit
		this.getPdf = wgslTagFn/* wgsl */`
			fn getEmissiveTrianglePdf( position: vec3f, point: vec3f, normal: vec3f, objectIndex: u32, triangleIndex: u32 ) -> f32 {

				if ( ${ countNode } == 0u ) {

					return 0.0;

				}

				let listIndex = ${ getListIndexFn }( objectIndex, triangleIndex );
				if ( listIndex < 0 ) {

					return 0.0;

				}

				let triangle = ${ readTriangleFn }( u32( listIndex ) );
				let toPosition = position - point;
				let distSq = dot( toPosition, toPosition );
				let cosLight = abs( dot( normal, toPosition ) ) * inverseSqrt( distSq );
				if ( triangle.area <= 0.0 || distSq <= 0.0 || cosLight <= 0.0 ) {

					return 0.0;

				}

				// walk down to the triangle's leaf, multiplying the chance of each child on the way. A first child's
				// nodes all come before the second child
				var node = ${ readNodeFn }( 0u );
				var pickPdf = 1.0;
				while ( ! node.isLeaf ) {

					let firstChild = ${ readNodeFn }( node.firstChild );
					let secondChild = ${ readNodeFn }( node.secondChild );
					let firstChance = ${ getFirstChildChanceFn }( firstChild, secondChild, position );
					if ( firstChance < 0.0 ) {

						return 0.0;

					}

					if ( triangle.leafNode < node.secondChild ) {

						node = firstChild;
						pickPdf *= firstChance;

					} else {

						node = secondChild;
						pickPdf *= 1.0 - firstChance;

					}

				}

				return pickPdf / triangle.area * distSq / cosLight;

			}
		`;

	}

}
