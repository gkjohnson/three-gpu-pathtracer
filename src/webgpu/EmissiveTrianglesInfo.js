import { texture, uniform } from 'three/tsl';
import { Box3, ColorManagement, Vector3, RGBAFormat, RGIntegerFormat, RGBAIntegerFormat, FloatType, UnsignedIntType } from 'three/webgpu';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { LightTreeBVH } from './LightTreeBVH.js';
import { LinearDataTexture } from './LinearDataTexture.js';
import { lightRecordStruct, lightTreeNodeStruct, emissiveTriangleStruct } from './nodes/structs.wgsl.js';
import { EMISSIVE_TRIANGLE_LIGHT_TYPE, writeLightPointFn } from './nodes/lights.wgsl.js';
import { getLinearTexelFn } from './nodes/utils.wgsl.js';

// avoids dividing by zero at the center of a light tree node with no size
const MIN_DISTANCE_SQ = 1e-20;

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

		// the number of emissive triangles
		this.triangleCountNode = uniform( 0, 'uint' );

		// The light tree nodes, two texels each:
		// - bounds min, power
		// - bounds max, second child node index or -( emissive triangle index + 1 ) for a leaf
		this.lightTreeTextureNode = texture( new LinearDataTexture( new Float32Array( 0 ), 4, RGBAFormat, FloatType ) ).setName( 'lightTree' );

		// The emissive triangles, grouped by object, one texel each:
		// - bvh object index, bvh triangle index, light tree leaf node index, area
		this.emissiveTrianglesTextureNode = texture( new LinearDataTexture( new Uint32Array( 0 ), 4, RGBAIntegerFormat, UnsignedIntType ) ).setName( 'emissiveTriangles' );

		// The first emissive triangle of each bvh object, one texel each:
		// - emissive triangle index + 1 (0 if the object doesn't emit), bvh triangle index
		this.firstTrianglesTextureNode = texture( new LinearDataTexture( new Uint32Array( 0 ), 2, RGIntegerFormat, UnsignedIntType ) ).setName( 'firstEmissiveTriangles' );

		this._initFns();

	}

	// Rebuilds the textures. Call when the scene, its materials or its transforms change
	// TODO: only rebuild the tree on a material change when an object starts or stops emitting
	update( bvhData ) {

		// the bvh data has not been built yet
		if ( bvhData.bvh === null ) {

			return;

		}

		// write the first triangle of each emissive object
		// TODO: store these as one offset in the object records
		const objectInfos = bvhData.getAllObjectInfo();
		const firstTriangles = new Uint32Array( objectInfos.length * 2 );
		const emissiveObjects = [];
		let emissiveTriangleCount = 0;
		objectInfos.forEach( info => {

			const { objectIndex: bvhObjectIndex, primitiveOffset, primitiveCount } = info;
			const luminance = getEmissiveLuminance( bvhData.getMaterial( info ) );
			if ( luminance > 0 && bvhData.isRecordVisible( bvhObjectIndex ) ) {

				firstTriangles[ bvhObjectIndex * 2 ] = emissiveTriangleCount + 1;
				firstTriangles[ bvhObjectIndex * 2 + 1 ] = primitiveOffset;
				emissiveObjects.push( { bvhObjectIndex, luminance } );
				emissiveTriangleCount += primitiveCount;

			}

		} );

		// write the emissive triangles
		// TODO: point the tree's leaves at the bvh's geometry data instead so it isn't duplicated here
		const trianglesUint32 = new Uint32Array( emissiveTriangleCount * 4 );
		const trianglesFloat32 = new Float32Array( trianglesUint32.buffer );
		const triangleBounds = new Float32Array( emissiveTriangleCount * 6 );
		const trianglePowers = new Float32Array( emissiveTriangleCount );
		let emissiveTriangleIndex = 0;
		emissiveObjects.forEach( ( { bvhObjectIndex, luminance } ) => {

			bvhData.forEachTriangle( bvhObjectIndex, ( triangle, bvhTriangleIndex ) => {

				const area = triangle.getArea();
				trianglesUint32[ emissiveTriangleIndex * 4 ] = bvhObjectIndex;
				trianglesUint32[ emissiveTriangleIndex * 4 + 1 ] = bvhTriangleIndex;
				trianglesFloat32[ emissiveTriangleIndex * 4 + 3 ] = area;
				trianglePowers[ emissiveTriangleIndex ] = area * luminance;

				_box.makeEmpty().expandByPoint( triangle.a ).expandByPoint( triangle.b ).expandByPoint( triangle.c );
				_box.min.toArray( triangleBounds, emissiveTriangleIndex * 6 );
				_box.max.toArray( triangleBounds, emissiveTriangleIndex * 6 + 3 );
				emissiveTriangleIndex ++;

			} );

		} );

		// build the light tree and write the leaf of each emissive triangle
		let lightTreeNodes = new Float32Array( 0 );
		if ( emissiveTriangleCount > 0 ) {

			const { nodesBuffer, leafNodeIndices } = new LightTreeBVH( triangleBounds, trianglePowers ).packNodesBuffer();
			leafNodeIndices.forEach( ( leafNodeIndex, i ) => trianglesUint32[ i * 4 + 2 ] = leafNodeIndex );
			lightTreeNodes = nodesBuffer;

		}

		// replace the textures
		this.dispose();
		this.triangleCountNode.value = emissiveTriangleCount;
		this.lightTreeTextureNode.value = new LinearDataTexture( lightTreeNodes, 4, RGBAFormat, FloatType );
		this.emissiveTrianglesTextureNode.value = new LinearDataTexture( trianglesUint32, 4, RGBAIntegerFormat, UnsignedIntType );
		this.firstTrianglesTextureNode.value = new LinearDataTexture( firstTriangles, 2, RGIntegerFormat, UnsignedIntType );

	}

	dispose() {

		this.lightTreeTextureNode.value.dispose();
		this.emissiveTrianglesTextureNode.value.dispose();
		this.firstTrianglesTextureNode.value.dispose();

	}

	_initFns() {

		const { lightTreeTextureNode, emissiveTrianglesTextureNode, firstTrianglesTextureNode, triangleCountNode } = this;
		const objectsStorage = contextProxy( 'bvhData.storage.objects' );
		const getTriangleIndices = contextProxyFn( 'bvhData.fns.getTriangleIndices' );
		const getVertexPosition = contextProxyFn( 'bvhData.fns.getVertexPosition' );
		const getHitEmission = contextProxyFn( 'shadingModel.fns.getHitEmission' );
		const getHitOpacity = contextProxyFn( 'shadingModel.fns.getHitOpacity' );

		const readLightTreeNodeFn = wgslTagFn/* wgsl */`
			fn readLightTreeNode( nodeIndex: u32 ) -> ${ lightTreeNodeStruct } {

				let width = textureDimensions( ${ lightTreeTextureNode } ).x;
				let boundsMinPower = textureLoad( ${ lightTreeTextureNode }, ${ getLinearTexelFn }( nodeIndex * 2u, width ), 0 );
				let boundsMaxChildOrTriangle = textureLoad( ${ lightTreeTextureNode }, ${ getLinearTexelFn }( nodeIndex * 2u + 1u, width ), 0 );

				// negative for a leaf
				let childOrTriangle = boundsMaxChildOrTriangle.w;

				var node: ${ lightTreeNodeStruct };
				node.boundsMin = boundsMinPower.xyz;
				node.boundsMax = boundsMaxChildOrTriangle.xyz;
				node.power = boundsMinPower.w;
				node.isLeaf = childOrTriangle < 0.0;
				if ( node.isLeaf ) {

					node.emissiveTriangleIndex = u32( - childOrTriangle - 1.0 );

				} else {

					node.firstChildIndex = nodeIndex + 1u;
					node.secondChildIndex = u32( childOrTriangle );

				}

				return node;

			}
		`;

		const readEmissiveTriangleFn = wgslTagFn/* wgsl */`
			fn readEmissiveTriangle( emissiveTriangleIndex: u32 ) -> ${ emissiveTriangleStruct } {

				let width = textureDimensions( ${ emissiveTrianglesTextureNode } ).x;
				let texel = textureLoad( ${ emissiveTrianglesTextureNode }, ${ getLinearTexelFn }( emissiveTriangleIndex, width ), 0 );

				var triangle: ${ emissiveTriangleStruct };
				triangle.bvhObjectIndex = texel.x;
				triangle.bvhTriangleIndex = texel.y;
				triangle.leafNodeIndex = texel.z;
				triangle.area = bitcast<f32>( texel.w );
				return triangle;

			}
		`;

		// returns the emissive triangle index of a bvh triangle, or -1 if its object doesn't emit
		const getEmissiveTriangleIndexFn = wgslTagFn/* wgsl */`
			fn getEmissiveTriangleIndex( bvhObjectIndex: u32, bvhTriangleIndex: u32 ) -> i32 {

				let width = textureDimensions( ${ firstTrianglesTextureNode } ).x;
				let texel = vec2i( textureLoad( ${ firstTrianglesTextureNode }, ${ getLinearTexelFn }( bvhObjectIndex, width ), 0 ).xy );
				let firstEmissiveTriangleIndex = texel.x - 1;
				let firstBvhTriangleIndex = texel.y;
				if ( firstEmissiveTriangleIndex < 0 ) {

					return - 1;

				}

				return firstEmissiveTriangleIndex + i32( bvhTriangleIndex ) - firstBvhTriangleIndex;

			}
		`;

		// Estimates how much a node lights a position, simplified from pbrt-v4's LightBounds::Importance. The distance is
		// clamped to the node's radius so it doesn't dominate positions inside it
		const getImportanceFn = wgslTagFn/* wgsl */`
			fn getLightTreeNodeImportance( node: ${ lightTreeNodeStruct }, position: vec3f ) -> f32 {

				let toCenter = ( node.boundsMin + node.boundsMax ) * 0.5 - position;
				let boundsSize = node.boundsMax - node.boundsMin;
				let distSq = dot( toCenter, toCenter );
				let radiusSq = dot( boundsSize, boundsSize ) * 0.25;
				return node.power / max( max( distSq, radiusSq ), ${ MIN_DISTANCE_SQ } );

			}
		`;

		// returns the chance of picking the first child, or -1 if neither child lights the position
		const getFirstChildChanceFn = wgslTagFn/* wgsl */`
			fn getFirstChildChance( firstChild: ${ lightTreeNodeStruct }, secondChild: ${ lightTreeNodeStruct }, position: vec3f ) -> f32 {

				let firstImportance = ${ getImportanceFn }( firstChild, position );
				let secondImportance = ${ getImportanceFn }( secondChild, position );
				let totalImportance = firstImportance + secondImportance;
				if ( totalImportance <= 0.0 ) {

					return - 1.0;

				}

				return firstImportance / totalImportance;

			}
		`;

		// estimates how much all the triangles light a position, for choosing between them and the other lights
		this.getWeight = wgslTagFn/* wgsl */`
			fn getEmissiveWeight( position: vec3f ) -> f32 {

				if ( ${ triangleCountNode } == 0u ) {

					return 0.0;

				}

				return ${ getImportanceFn }( ${ readLightTreeNodeFn }( 0u ), position );

			}
		`;

		// Samples the light from a point on an emissive triangle, picking the triangle with "ruv.x" and the point with
		// "ruv.yz". The pdf is zero if the side of the triangle facing the position doesn't emit
		this.sample = wgslTagFn/* wgsl */`
			fn sampleEmissiveTriangle( position: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				var lightRec: ${ lightRecordStruct };

				// pick a leaf by walking down the tree, rescaling the random number to reuse it at each node
				var node = ${ readLightTreeNodeFn }( 0u );
				var trianglePdf = 1.0;
				var random = ruv.x;
				while ( ! node.isLeaf ) {

					let firstChild = ${ readLightTreeNodeFn }( node.firstChildIndex );
					let secondChild = ${ readLightTreeNodeFn }( node.secondChildIndex );
					let firstChildChance = ${ getFirstChildChanceFn }( firstChild, secondChild, position );
					if ( firstChildChance < 0.0 ) {

						return lightRec;

					}

					if ( random < firstChildChance ) {

						node = firstChild;
						trianglePdf *= firstChildChance;
						random = random / firstChildChance;

					} else {

						node = secondChild;
						trianglePdf *= 1.0 - firstChildChance;
						random = ( random - firstChildChance ) / ( 1.0 - firstChildChance );

					}

				}

				// get the triangle of the leaf
				let triangle = ${ readEmissiveTriangleFn }( node.emissiveTriangleIndex );
				let objectInfo = ${ objectsStorage }[ triangle.bvhObjectIndex ];
				let indices = ${ getTriangleIndices }( triangle.bvhTriangleIndex, objectInfo.indexOffset );
				let a = ${ getVertexPosition }( indices.x, objectInfo.attributesOffset );
				let b = ${ getVertexPosition }( indices.y, objectInfo.attributesOffset );
				let c = ${ getVertexPosition }( indices.z, objectInfo.attributesOffset );
				let triangleNormal = normalize( ( transpose( objectInfo.inverseMatrixWorld ) * vec4f( cross( b - a, c - a ), 0.0 ) ).xyz );

				// pick a point uniformly over the triangle's area
				let sqrtRandom = sqrt( ruv.y );
				let barycoord = vec3f( 1.0 - sqrtRandom, ruv.z * sqrtRandom, ( 1.0 - ruv.z ) * sqrtRandom );
				let localPoint = barycoord.x * a + barycoord.y * b + barycoord.z * c;
				let lightPoint = ( objectInfo.matrixWorld * vec4f( localPoint, 1.0 ) ).xyz;

				let toPosition = position - lightPoint;
				let distSq = dot( toPosition, toPosition );
				let cosLight = dot( triangleNormal, toPosition ) * inverseSqrt( distSq );
				let side = select( - 1.0, 1.0, cosLight > 0.0 );

				// get the light emitted toward the position, scaled by the surface's opacity
				let opacity = ${ getHitOpacity }( objectInfo.materialIndex, objectInfo.color.a, indices, objectInfo.attributesOffset, barycoord, side );
				let emission = opacity * ${ getHitEmission }( objectInfo.materialIndex, indices, objectInfo.attributesOffset, barycoord, side );
				if ( triangle.area <= 0.0 || distSq <= 0.0 || cosLight == 0.0 || all( emission == vec3f( 0.0 ) ) ) {

					return lightRec;

				}

				${ writeLightPointFn }( &lightRec, position, lightPoint, triangleNormal );
				lightRec.emission = emission;
				lightRec.lightType = ${ EMISSIVE_TRIANGLE_LIGHT_TYPE };

				// convert the pdf from the triangle's area to solid angle
				lightRec.pdf = trianglePdf / triangle.area * distSq / abs( cosLight );
				return lightRec;

			}
		`;

		// Returns the pdf of "sampleEmissiveTriangle" sampling a point on a bvh triangle, or zero if its object doesn't emit
		this.getPdf = wgslTagFn/* wgsl */`
			fn getEmissiveTrianglePdf( position: vec3f, lightPoint: vec3f, triangleNormal: vec3f, bvhObjectIndex: u32, bvhTriangleIndex: u32 ) -> f32 {

				if ( ${ triangleCountNode } == 0u ) {

					return 0.0;

				}

				let emissiveTriangleIndex = ${ getEmissiveTriangleIndexFn }( bvhObjectIndex, bvhTriangleIndex );
				if ( emissiveTriangleIndex < 0 ) {

					return 0.0;

				}

				let triangle = ${ readEmissiveTriangleFn }( u32( emissiveTriangleIndex ) );
				let toPosition = position - lightPoint;
				let distSq = dot( toPosition, toPosition );
				let cosLight = abs( dot( triangleNormal, toPosition ) ) * inverseSqrt( distSq );
				if ( triangle.area <= 0.0 || distSq <= 0.0 || cosLight <= 0.0 ) {

					return 0.0;

				}

				// walk down the tree to the triangle's leaf. Nodes before the second child are under the first child
				var node = ${ readLightTreeNodeFn }( 0u );
				var trianglePdf = 1.0;
				while ( ! node.isLeaf ) {

					let firstChild = ${ readLightTreeNodeFn }( node.firstChildIndex );
					let secondChild = ${ readLightTreeNodeFn }( node.secondChildIndex );
					let firstChildChance = ${ getFirstChildChanceFn }( firstChild, secondChild, position );
					if ( firstChildChance < 0.0 ) {

						return 0.0;

					}

					if ( triangle.leafNodeIndex < node.secondChildIndex ) {

						node = firstChild;
						trianglePdf *= firstChildChance;

					} else {

						node = secondChild;
						trianglePdf *= 1.0 - firstChildChance;

					}

				}

				// convert the pdf from the triangle's area to solid angle
				return trianglePdf / triangle.area * distSq / cosLight;

			}
		`;

	}

}
