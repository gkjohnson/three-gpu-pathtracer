import { texture, uniform } from 'three/tsl';
import { Box3, ColorManagement, Vector3, RGBAFormat, RGIntegerFormat, RGBAIntegerFormat, FloatType, UnsignedIntType } from 'three/webgpu';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { LightTreeBVH } from './LightTreeBVH.js';
import { LinearDataTexture } from './LinearDataTexture.js';
import { lightRecordStruct, lightTreeNodeStruct, emissiveTriangleStruct } from './nodes/structs.wgsl.js';
import { EMISSIVE_TRIANGLE_LIGHT_TYPE, writeLightPointFn } from './nodes/lights.wgsl.js';
import { getLinearTexelFn } from './nodes/utils.wgsl.js';

// avoids dividing by zero when a position is at the center of a node without size
const DISTANCE_EPSILON = 1e-20;

const _box = /* @__PURE__ */ new Box3();
const _emissive = /* @__PURE__ */ new Vector3();
const _luminanceCoefficients = /* @__PURE__ */ new Vector3();

// returns the material's emitted luminance, ignoring its emissive map
function getEmissiveLuminance( material ) {

	if ( ! material || ! material.emissive ) {

		return 0;

	}

	const { emissive, emissiveIntensity = 1 } = material;
	ColorManagement.getLuminanceCoefficients( _luminanceCoefficients );
	return _emissive.setFromColor( emissive ).dot( _luminanceCoefficients ) * emissiveIntensity;

}

// Samples emissive triangles as lights using a light tree, as in pbrt-v4
export class EmissiveTrianglesInfo {

	constructor() {

		this.countNode = uniform( 0, 'uint' );
		this.treeNode = texture( new LinearDataTexture( new Float32Array( 0 ), 4, RGBAFormat, FloatType ) ).setName( 'emissiveTree' );
		this.trianglesNode = texture( new LinearDataTexture( new Uint32Array( 0 ), 4, RGBAIntegerFormat, UnsignedIntType ) ).setName( 'emissiveTriangles' );
		this.objectsNode = texture( new LinearDataTexture( new Uint32Array( 0 ), 2, RGIntegerFormat, UnsignedIntType ) ).setName( 'emissiveObjects' );

		this._initFns();

	}

	// Rebuilds the textures. Call when the scene, its materials or its transforms change
	// TODO: only rebuild the tree on a material change when an object starts or stops emitting
	update( bvhData ) {

		// the bvh data has not been built yet
		if ( bvhData.bvh === null ) {

			return;

		}

		// write the first list index plus one and first triangle index of each emissive object
		// TODO: store these as one offset in the object records
		const objectInfos = bvhData.getAllObjectInfo();
		const objectsBuffer = new Uint32Array( objectInfos.length * 2 );
		const emissiveObjects = [];
		let count = 0;
		objectInfos.forEach( info => {

			const { objectIndex, primitiveOffset, primitiveCount } = info;
			const luminance = getEmissiveLuminance( bvhData.getRecordMaterial( objectIndex ) );
			if ( luminance > 0 ) {

				objectsBuffer[ objectIndex * 2 ] = count + 1;
				objectsBuffer[ objectIndex * 2 + 1 ] = primitiveOffset;
				emissiveObjects.push( { info, luminance } );
				count += primitiveCount;

			}

		} );

		// write the list of triangles
		const trianglesBuffer = new Uint32Array( count * 4 );
		const trianglesFloat32 = new Float32Array( trianglesBuffer.buffer );
		const bounds = new Float32Array( count * 6 );
		const powers = new Float32Array( count );
		let listIndex = 0;
		emissiveObjects.forEach( ( { info, luminance } ) => {

			bvhData.forEachTriangle( info, ( triangle, triangleIndex ) => {

				const area = triangle.getArea();
				trianglesBuffer[ listIndex * 4 ] = info.objectIndex;
				trianglesBuffer[ listIndex * 4 + 1 ] = triangleIndex;
				trianglesFloat32[ listIndex * 4 + 3 ] = area;
				powers[ listIndex ] = area * luminance;

				_box.makeEmpty().expandByPoint( triangle.a ).expandByPoint( triangle.b ).expandByPoint( triangle.c );
				_box.min.toArray( bounds, listIndex * 6 );
				_box.max.toArray( bounds, listIndex * 6 + 3 );
				listIndex ++;

			} );

		} );

		// build the tree and write the leaf of each triangle
		let treeBuffer = new Float32Array( 0 );
		if ( count > 0 ) {

			const { nodesBuffer, triangleLeaves } = new LightTreeBVH( bounds ).packNodesBuffer( powers );
			triangleLeaves.forEach( ( leafNode, i ) => trianglesBuffer[ i * 4 + 2 ] = leafNode );
			treeBuffer = nodesBuffer;

		}

		// replace the textures
		this.dispose();
		this.countNode.value = count;
		this.treeNode.value = new LinearDataTexture( treeBuffer, 4, RGBAFormat, FloatType );
		this.trianglesNode.value = new LinearDataTexture( trianglesBuffer, 4, RGBAIntegerFormat, UnsignedIntType );
		this.objectsNode.value = new LinearDataTexture( objectsBuffer, 2, RGIntegerFormat, UnsignedIntType );

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
				let boundsMinPower = textureLoad( ${ treeNode }, ${ getLinearTexelFn }( index * 2u, width ), 0 );
				let boundsMaxLink = textureLoad( ${ treeNode }, ${ getLinearTexelFn }( index * 2u + 1u, width ), 0 );

				// the second child, or -( listIndex + 1 ) for a leaf
				let link = boundsMaxLink.w;

				var node: ${ lightTreeNodeStruct };
				node.boundsMin = boundsMinPower.xyz;
				node.boundsMax = boundsMaxLink.xyz;
				node.power = boundsMinPower.w;
				node.isLeaf = link < 0.0;
				if ( node.isLeaf ) {

					node.listIndex = u32( - link - 1.0 );

				} else {

					node.firstChild = index + 1u;
					node.secondChild = u32( link );

				}

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

		// returns the list index of an object's triangle, or -1 if the object doesn't emit
		const getListIndexFn = wgslTagFn/* wgsl */`
			fn getEmissiveListIndex( objectIndex: u32, triangleIndex: u32 ) -> i32 {

				let width = textureDimensions( ${ objectsNode } ).x;
				let data = vec2i( textureLoad( ${ objectsNode }, ${ getLinearTexelFn }( objectIndex, width ), 0 ).xy );
				let firstListIndex = data.x - 1;
				let firstTriangleIndex = data.y;
				if ( firstListIndex < 0 ) {

					return - 1;

				}

				return firstListIndex + i32( triangleIndex ) - firstTriangleIndex;

			}
		`;

		// Estimates how much a node lights a position, simplified from pbrt-v4's LightBounds::Importance. The distance is
		// clamped to the node's radius so it doesn't dominate positions inside it
		const getImportanceFn = wgslTagFn/* wgsl */`
			fn getLightTreeNodeImportance( node: ${ lightTreeNodeStruct }, position: vec3f ) -> f32 {

				let toCenter = ( node.boundsMin + node.boundsMax ) * 0.5 - position;
				let size = node.boundsMax - node.boundsMin;
				let distSq = dot( toCenter, toCenter );
				let radiusSq = dot( size, size ) * 0.25;
				return node.power / max( max( distSq, radiusSq ), ${ DISTANCE_EPSILON } );

			}
		`;

		// returns the chance of picking the first child, or -1 if neither child lights the position
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

		// estimates how much all the triangles light a position, for choosing between them and the other lights
		this.getWeight = wgslTagFn/* wgsl */`
			fn getEmissiveWeight( position: vec3f ) -> f32 {

				if ( ${ countNode } == 0u ) {

					return 0.0;

				}

				return ${ getImportanceFn }( ${ readNodeFn }( 0u ), position );

			}
		`;

		// Samples the light from a point on an emissive triangle, picking the triangle with "ruv.x" and the point with
		// "ruv.yz". The pdf is zero if the side of the triangle facing the position doesn't emit
		this.sample = wgslTagFn/* wgsl */`
			fn sampleEmissiveTriangle( position: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				var lightRec: ${ lightRecordStruct };

				// pick a leaf by walking down the tree, rescaling the random number to reuse it at each node
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

				// get the leaf's triangle
				let triangle = ${ readTriangleFn }( node.listIndex );
				let objectInfo = ${ objectsStorage }[ triangle.objectIndex ];
				let indices = ${ getTriangleIndices }( triangle.triangleIndex, objectInfo.indexOffset );
				let a = ${ getVertexPosition }( indices.x, objectInfo.attributesOffset );
				let b = ${ getVertexPosition }( indices.y, objectInfo.attributesOffset );
				let c = ${ getVertexPosition }( indices.z, objectInfo.attributesOffset );
				let normal = normalize( ( transpose( objectInfo.inverseMatrixWorld ) * vec4f( cross( b - a, c - a ), 0.0 ) ).xyz );

				// pick a point uniformly over the triangle's area
				let su = sqrt( ruv.y );
				let barycoord = vec3f( 1.0 - su, ruv.z * su, su - ruv.z * su );
				let localPoint = barycoord.x * a + barycoord.y * b + barycoord.z * c;
				let point = ( objectInfo.matrixWorld * vec4f( localPoint, 1.0 ) ).xyz;

				let toPosition = position - point;
				let distSq = dot( toPosition, toPosition );
				let cosLight = dot( normal, toPosition ) * inverseSqrt( distSq );
				let side = select( - 1.0, 1.0, cosLight > 0.0 );

				// get the light emitted toward the position, scaled by the surface's opacity
				let opacity = ${ getHitOpacity }( objectInfo.materialIndex, objectInfo.color.a, indices, objectInfo.attributesOffset, barycoord, side );
				let emission = opacity * ${ getHitEmission }( objectInfo.materialIndex, indices, objectInfo.attributesOffset, barycoord, side );
				if ( triangle.area <= 0.0 || distSq <= 0.0 || cosLight == 0.0 || all( emission == vec3f( 0.0 ) ) ) {

					return lightRec;

				}

				${ writeLightPointFn }( &lightRec, position, point, normal );
				lightRec.emission = emission;
				lightRec.lightType = ${ EMISSIVE_TRIANGLE_LIGHT_TYPE };

				// convert the pdf from the triangle's area to solid angle
				lightRec.pdf = pickPdf / triangle.area * distSq / abs( cosLight );
				return lightRec;

			}
		`;

		// Returns the pdf of "sampleEmissiveTriangle" sampling the given point on a triangle, or zero if its object doesn't emit
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

				// walk down the tree to the triangle's leaf. Nodes before the second child are under the first child
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

				// convert the pdf from the triangle's area to solid angle
				return pickPdf / triangle.area * distSq / cosLight;

			}
		`;

	}

}
