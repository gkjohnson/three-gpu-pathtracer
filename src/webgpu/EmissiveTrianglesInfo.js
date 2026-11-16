import { texture, uniform } from 'three/tsl';
import { Matrix4, Vector3, RGBAFormat, RGIntegerFormat, RGBAIntegerFormat, FloatType, UnsignedIntType, BackSide, DoubleSide } from 'three/webgpu';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { LinearDataTexture } from './LinearDataTexture.js';
import { lightRecordStruct } from './nodes/structs.wgsl.js';
import { EMISSIVE_TRIANGLE_LIGHT_TYPE } from './nodes/lights.wgsl.js';

// where an object's visibility and material index sit in its transform, after its two matrices
const TRANSFORM_VISIBLE_WORD = 32;
const TRANSFORM_MATERIAL_WORD = 33;

// The floats of a light tree node, three texels:
// - its bounds' min and its power
// - its bounds' max and the cosine of its emission cone's spread, -1 when it emits in every direction
// - its emission cone's axis, and its second child's node index, or -( emitter index + 1 ) for a leaf
// The first child follows its node. Indices are stored as floats, exact up to 2^24
const NODE_FLOATS = 12;

// the smallest squared distance the importance measures the direction to a node with
const IMPORTANCE_DISTANCE_EPSILON = 1e-20;

const _matrix = /* @__PURE__ */ new Matrix4();
const _a = /* @__PURE__ */ new Vector3();
const _b = /* @__PURE__ */ new Vector3();
const _c = /* @__PURE__ */ new Vector3();
const _edge1 = /* @__PURE__ */ new Vector3();
const _edge2 = /* @__PURE__ */ new Vector3();
const _axis = /* @__PURE__ */ new Vector3();
const _otherAxis = /* @__PURE__ */ new Vector3();
const _rotationAxis = /* @__PURE__ */ new Vector3();

// Grows the cone around "axis" with spread cosine "cos" to also hold the other cone, writing the new axis to "axis"
// and returning the new spread cosine. See DirectionCone's Union in pbrt-v4
function unionCone( axis, cos, otherAxis, otherCos ) {

	if ( cos <= - 1 || otherCos <= - 1 ) {

		return - 1;

	}

	const theta = Math.acos( Math.min( cos, 1 ) );
	const otherTheta = Math.acos( Math.min( otherCos, 1 ) );
	const between = axis.angleTo( otherAxis );

	// one cone already holds the other
	if ( Math.min( between + otherTheta, Math.PI ) <= theta ) {

		return cos;

	}

	if ( Math.min( between + theta, Math.PI ) <= otherTheta ) {

		axis.copy( otherAxis );
		return otherCos;

	}

	// the smallest cone around both, its axis rotated from this one's toward the other's
	const spread = ( theta + between + otherTheta ) / 2;
	if ( spread >= Math.PI ) {

		return - 1;

	}

	_rotationAxis.crossVectors( axis, otherAxis );
	if ( _rotationAxis.lengthSq() === 0 ) {

		return - 1;

	}

	axis.applyAxisAngle( _rotationAxis.normalize(), spread - theta );
	return Math.cos( spread );

}

// The scene's emissive triangles, sampled as a light. A light tree picks a triangle for a point: each node holds
// the bounds, total power and emission directions of the triangles under it, and the walk from the root picks
// each child by how much light it could send to the point, see LightBounds in pbrt-v4. Emissive maps color the
// sampled point but don't change which triangle is picked. Three textures hold the triangles:
// - "emissiveTree": the tree's nodes, three texels each, one leaf per triangle.
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

		const { storage: bvhStorage, structs, triangleRanges } = bvhData;
		const index = bvhStorage.index.proxyNode.value.array;
		const attributes = new Float32Array( bvhStorage.attributes.proxyNode.value.array.buffer );
		const transformsU32 = bvhStorage.transforms.proxyNode.value.array;
		const transformsF32 = new Float32Array( transformsU32.buffer, transformsU32.byteOffset, transformsU32.length );

		// each vertex attribute is a vec4f
		const attributeStride = structs.attributes.getLength();
		const positionOffset = structs.attributes.membersLayout.findIndex( ( { name } ) => name === 'position' ) * 4;
		const transformStride = structs.transform.getLength();

		// Every triangle of each emissive object, in order so a hit triangle's place in the list follows from its
		// object's first one: its object and triangle index, area, bounds, power and the direction it emits to.
		// Triangles without area are kept, with no power
		const triangles = [];
		const areas = [];
		const bounds = [];
		const powers = [];
		const axes = [];
		const cones = [];
		const objects = new Uint32Array( triangleRanges.length * 2 );
		triangleRanges.forEach( ( { offset, count }, objectIndex ) => {

			// skip objects that are hidden or don't emit
			const slot = objectIndex * transformStride;
			const material = shadingModel.materials[ transformsU32[ slot + TRANSFORM_MATERIAL_WORD ] ];
			if ( transformsU32[ slot + TRANSFORM_VISIBLE_WORD ] === 0 || ! material || ! material.emissive ) {

				return;

			}

			const { r, g, b } = material.emissive;
			const luminance = ( 0.2126 * r + 0.7152 * g + 0.0722 * b ) * ( material.emissiveIntensity ?? 1 );
			if ( ! ( luminance > 0 ) ) {

				return;

			}

			// the object's first triangle in the list, plus one so zero means it doesn't emit
			objects[ objectIndex * 2 ] = powers.length + 1;
			objects[ objectIndex * 2 + 1 ] = offset;

			_matrix.fromArray( transformsF32, slot );
			for ( let t = offset; t < offset + count; t ++ ) {

				_a.fromArray( attributes, index[ t * 3 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_b.fromArray( attributes, index[ t * 3 + 1 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_c.fromArray( attributes, index[ t * 3 + 2 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_axis.crossVectors( _edge1.subVectors( _b, _a ), _edge2.subVectors( _c, _a ) );
				const area = 0.5 * _axis.length();

				// a single sided triangle emits around its normal, flipped for the back side
				const cone = material.side === DoubleSide || area === 0 ? - 1 : 1;
				_axis.normalize();
				if ( material.side === BackSide ) {

					_axis.negate();

				}

				triangles.push( objectIndex, t );
				areas.push( area );
				bounds.push(
					Math.min( _a.x, _b.x, _c.x ), Math.min( _a.y, _b.y, _c.y ), Math.min( _a.z, _b.z, _c.z ),
					Math.max( _a.x, _b.x, _c.x ), Math.max( _a.y, _b.y, _c.y ), Math.max( _a.z, _b.z, _c.z ),
				);
				powers.push( area * luminance );
				axes.push( _axis.x || 0, _axis.y || 0, _axis.z || 1 );
				cones.push( cone );

			}

		} );

		const count = powers.length;
		const { nodes, leaves } = this._buildTree( count, bounds, powers, axes, cones );

		// each triangle's object index, triangle index, leaf node and area bits
		const triangleData = new Uint32Array( Math.max( count, 1 ) * 4 );
		const areaBits = new Uint32Array( new Float32Array( areas ).buffer );
		for ( let i = 0; i < count; i ++ ) {

			triangleData[ i * 4 ] = triangles[ i * 2 ];
			triangleData[ i * 4 + 1 ] = triangles[ i * 2 + 1 ];
			triangleData[ i * 4 + 2 ] = leaves[ i ];
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

	// Builds the light tree over the triangles, splitting each node at the middle of its triangles' centers along
	// their widest axis. Returns the nodes and each triangle's leaf node
	_buildTree( count, bounds, powers, axes, cones ) {

		const nodes = new Float32Array( Math.max( 2 * count - 1, 1 ) * NODE_FLOATS );
		const leaves = new Uint32Array( count );
		const order = new Uint32Array( count );
		for ( let i = 0; i < count; i ++ ) {

			order[ i ] = i;

		}

		const center = ( i, axis ) => bounds[ i * 6 + axis ] + bounds[ i * 6 + 3 + axis ];

		let nodeCount = 0;
		const build = ( start, end ) => {

			const node = nodeCount ++;
			const base = node * NODE_FLOATS;

			// a leaf takes its triangle's values
			if ( end - start === 1 ) {

				const i = order[ start ];
				nodes[ base ] = bounds[ i * 6 ];
				nodes[ base + 1 ] = bounds[ i * 6 + 1 ];
				nodes[ base + 2 ] = bounds[ i * 6 + 2 ];
				nodes[ base + 3 ] = powers[ i ];
				nodes[ base + 4 ] = bounds[ i * 6 + 3 ];
				nodes[ base + 5 ] = bounds[ i * 6 + 4 ];
				nodes[ base + 6 ] = bounds[ i * 6 + 5 ];
				nodes[ base + 7 ] = cones[ i ];
				nodes[ base + 8 ] = axes[ i * 3 ];
				nodes[ base + 9 ] = axes[ i * 3 + 1 ];
				nodes[ base + 10 ] = axes[ i * 3 + 2 ];
				nodes[ base + 11 ] = - ( i + 1 );
				leaves[ i ] = node;
				return;

			}

			// the widest axis of the triangles' centers, and its middle
			let axis = 0;
			let middle = 0;
			let widest = - 1;
			for ( let a = 0; a < 3; a ++ ) {

				let min = Infinity;
				let max = - Infinity;
				for ( let j = start; j < end; j ++ ) {

					const c = center( order[ j ], a );
					min = Math.min( min, c );
					max = Math.max( max, c );

				}

				if ( max - min > widest ) {

					widest = max - min;
					axis = a;
					middle = ( min + max ) / 2;

				}

			}

			// move the triangles below the middle first, splitting in half when they're all on one side
			let split = start;
			for ( let j = start; j < end; j ++ ) {

				if ( center( order[ j ], axis ) < middle ) {

					const swap = order[ j ];
					order[ j ] = order[ split ];
					order[ split ] = swap;
					split ++;

				}

			}

			if ( split === start || split === end ) {

				split = ( start + end ) >> 1;

			}

			const first = nodeCount;
			build( start, split );
			const second = nodeCount;
			build( split, end );

			// the node holds both children: their bounds, total power and a cone around both their cones
			const firstBase = first * NODE_FLOATS;
			const secondBase = second * NODE_FLOATS;
			for ( let k = 0; k < 3; k ++ ) {

				nodes[ base + k ] = Math.min( nodes[ firstBase + k ], nodes[ secondBase + k ] );
				nodes[ base + 4 + k ] = Math.max( nodes[ firstBase + 4 + k ], nodes[ secondBase + 4 + k ] );

			}

			nodes[ base + 3 ] = nodes[ firstBase + 3 ] + nodes[ secondBase + 3 ];

			_axis.fromArray( nodes, firstBase + 8 );
			_otherAxis.fromArray( nodes, secondBase + 8 );
			nodes[ base + 7 ] = unionCone( _axis, nodes[ firstBase + 7 ], _otherAxis, nodes[ secondBase + 7 ] );
			nodes[ base + 8 ] = _axis.x;
			nodes[ base + 9 ] = _axis.y;
			nodes[ base + 10 ] = _axis.z;
			nodes[ base + 11 ] = second;

		};

		if ( count > 0 ) {

			build( 0, count );

		}

		return { nodes, leaves };

	}

	_initFns() {

		const { treeTextureNode, trianglesTextureNode, objectsTextureNode, countNode } = this;
		const materialsStorage = contextProxy( 'shadingModel.storage.materials' );
		const transformsStorage = contextProxy( 'bvhData.storage.transforms' );
		const indexStorage = contextProxy( 'bvhData.storage.index' );
		const attributesStorage = contextProxy( 'bvhData.storage.attributes' );
		const getUvFromChannel = contextProxyFn( 'bvhData.fns.getUvFromChannel' );
		const sampleTexel = contextProxyFn( 'shadingModel.fns.sampleTexel' );

		this.getCount = wgslTagFn/* wgsl */`
			fn getEmissiveTriangleCount() -> u32 {

				return ${ countNode };

			}
		`;

		// texel "i" of the tree
		const readTreeFn = wgslTagFn/* wgsl */`
			fn readEmissiveTree( i: u32 ) -> vec4f {

				let width = textureDimensions( ${ treeTextureNode } ).x;
				return textureLoad( ${ treeTextureNode }, vec2u( i % width, i / width ), 0 );

			}
		`;

		// How much light a node could send to "position": its power over the squared distance, times the cosine of
		// the smallest angle between the directions it emits to and the direction to the position. See
		// LightBounds::Importance() in pbrt-v4, without the receiver's normal
		const getImportanceFn = wgslTagFn/* wgsl */`
			fn getEmissiveNodeImportance( node: u32, position: vec3f ) -> f32 {

				let first = ${ readTreeFn }( node * 3u );
				let second = ${ readTreeFn }( node * 3u + 1u );
				let axis = ${ readTreeFn }( node * 3u + 2u ).xyz;
				let power = first.w;
				let cosEmit = second.w;

				let center = ( first.xyz + second.xyz ) * 0.5;
				let offset = position - center;
				let distSq = dot( offset, offset );
				let radiusSq = dot( second.xyz - first.xyz, second.xyz - first.xyz ) * 0.25;

				// the angle from the cone's axis to the position, less the cone's spread
				let toPosition = offset * inverseSqrt( max( distSq, ${ IMPORTANCE_DISTANCE_EPSILON } ) );
				let cosToPosition = dot( axis, toPosition );
				let sinToPosition = sqrt( max( 1.0 - cosToPosition * cosToPosition, 0.0 ) );
				let sinEmit = sqrt( max( 1.0 - cosEmit * cosEmit, 0.0 ) );
				var cosAngle = 1.0;
				var sinAngle = 0.0;
				if ( cosToPosition < cosEmit ) {

					cosAngle = cosToPosition * cosEmit + sinToPosition * sinEmit;
					sinAngle = sinToPosition * cosEmit - cosToPosition * sinEmit;

				}

				// less the angle the bounds cover as seen from the position, all of it from inside them
				var cosBounds = - 1.0;
				if ( distSq > radiusSq ) {

					cosBounds = sqrt( 1.0 - radiusSq / distSq );

				}

				let sinBounds = sqrt( max( 1.0 - cosBounds * cosBounds, 0.0 ) );
				var cosClosest = 1.0;
				if ( cosAngle < cosBounds ) {

					cosClosest = cosAngle * cosBounds + sinAngle * sinBounds;

				}

				// the triangles emit over the hemisphere around their normal
				if ( cosClosest <= 0.0 ) {

					return 0.0;

				}

				return power * cosClosest / max( distSq, radiusSq );

			}
		`;

		// Picks an emissive triangle by walking the tree with "ruv.x", and a point on it with "ruv.yz", and returns
		// the light from that point toward "position". The pdf is zero when the side facing "position" doesn't emit
		this.sample = wgslTagFn/* wgsl */`
			fn sampleEmissiveTriangle( position: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				var lightRec: ${ lightRecordStruct };

				// walk down the tree, picking each child by its importance and reusing the random number
				var node = 0u;
				var pickPdf = 1.0;
				var r = ruv.x;
				var link = ${ readTreeFn }( 2u ).w;
				while ( link >= 0.0 ) {

					let first = node + 1u;
					let second = u32( link );
					let firstImportance = ${ getImportanceFn }( first, position );
					let secondImportance = ${ getImportanceFn }( second, position );
					let total = firstImportance + secondImportance;
					if ( total <= 0.0 ) {

						return lightRec;

					}

					let firstChance = firstImportance / total;
					if ( r < firstChance ) {

						node = first;
						pickPdf *= firstChance;
						r = r / firstChance;

					} else {

						node = second;
						pickPdf *= 1.0 - firstChance;
						r = ( r - firstChance ) / ( 1.0 - firstChance );

					}

					link = ${ readTreeFn }( node * 3u + 2u ).w;

				}

				// the picked triangle's object, material and world space vertices
				let entry = u32( - link - 1.0 );
				let width = textureDimensions( ${ trianglesTextureNode } ).x;
				let ids = textureLoad( ${ trianglesTextureNode }, vec2u( entry % width, entry / width ), 0 );
				let objectInfo = &${ transformsStorage }[ ids.x ];
				let materialInfo = &${ materialsStorage }[ objectInfo.materialIndex ];

				let i0 = ${ indexStorage }[ ids.y * 3u ];
				let i1 = ${ indexStorage }[ ids.y * 3u + 1u ];
				let i2 = ${ indexStorage }[ ids.y * 3u + 2u ];
				let p0 = ( objectInfo.matrixWorld * vec4f( ${ attributesStorage }[ i0 ].position.xyz, 1.0 ) ).xyz;
				let p1 = ( objectInfo.matrixWorld * vec4f( ${ attributesStorage }[ i1 ].position.xyz, 1.0 ) ).xyz;
				let p2 = ( objectInfo.matrixWorld * vec4f( ${ attributesStorage }[ i2 ].position.xyz, 1.0 ) ).xyz;

				// a random point, uniform over the triangle's area
				let su = sqrt( ruv.y );
				let b0 = 1.0 - su;
				let b1 = ruv.z * su;
				let b2 = 1.0 - b0 - b1;
				let point = b0 * p0 + b1 * p1 + b2 * p2;

				let toLight = point - position;
				let distSq = dot( toLight, toLight );
				let normal = normalize( cross( p1 - p0, p2 - p0 ) );
				let direction = toLight * inverseSqrt( distSq );

				// whether the side facing "position" emits: front, back or both, by the material's side
				let cosLight = - dot( normal, direction );
				let facing = select( cosLight * materialInfo.side, abs( cosLight ), materialInfo.side == 0.0 );
				let area = bitcast<f32>( ids.w );
				if ( distSq <= 0.0 || facing <= 0.0 || area <= 0.0 ) {

					return lightRec;

				}

				// the emissive color, times the emissive map at the point
				var emission = materialInfo.emissiveIntensity * materialInfo.emissive;
				if ( materialInfo.emissiveMap != - 1 ) {

					let uv0 = ${ getUvFromChannel }( ${ attributesStorage }[ i0 ], materialInfo.emissiveMap );
					let uv1 = ${ getUvFromChannel }( ${ attributesStorage }[ i1 ], materialInfo.emissiveMap );
					let uv2 = ${ getUvFromChannel }( ${ attributesStorage }[ i2 ], materialInfo.emissiveMap );
					let uv = b0 * uv0 + b1 * uv1 + b2 * uv2;
					let uvPrime = materialInfo.emissiveMapTransform * vec3f( uv, 1.0 );
					emission *= ${ sampleTexel }( uvPrime.xy, materialInfo.emissiveMap, 0.0 ).rgb;

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

		// The pdf of "sampleEmissiveTriangle" picking "position" on an object's triangle, as seen from "origin", where
		// the triangle faces "normal". Zero when the object doesn't emit. Walks down the tree to the triangle's leaf,
		// multiplying the chances of each child on the way. Used to MIS weight emission that bsdf rays hit
		this.getPdf = wgslTagFn/* wgsl */`
			fn getEmissiveTrianglePdf( origin: vec3f, position: vec3f, normal: vec3f, objectIndex: u32, triangleIndex: u32 ) -> f32 {

				if ( ${ countNode } == 0u ) {

					return 0.0;

				}

				// the triangle's place in the list, from its object's first triangle
				let objectsWidth = textureDimensions( ${ objectsTextureNode } ).x;
				let objectEntry = textureLoad( ${ objectsTextureNode }, vec2u( objectIndex % objectsWidth, objectIndex / objectsWidth ), 0 ).xy;
				if ( objectEntry.x == 0u ) {

					return 0.0;

				}

				let entry = objectEntry.x - 1u + triangleIndex - objectEntry.y;
				let width = textureDimensions( ${ trianglesTextureNode } ).x;
				let ids = textureLoad( ${ trianglesTextureNode }, vec2u( entry % width, entry / width ), 0 );
				let leaf = ids.z;
				let area = bitcast<f32>( ids.w );

				let toHit = position - origin;
				let distSq = dot( toHit, toHit );
				let cosLight = abs( dot( normal, toHit ) ) * inverseSqrt( distSq );
				if ( area <= 0.0 || distSq <= 0.0 || cosLight <= 0.0 ) {

					return 0.0;

				}

				// walk down to the leaf the same way the sampling would have: its nodes come before the second child's
				var node = 0u;
				var pickPdf = 1.0;
				while ( node != leaf ) {

					let first = node + 1u;
					let second = u32( ${ readTreeFn }( node * 3u + 2u ).w );
					let firstImportance = ${ getImportanceFn }( first, origin );
					let secondImportance = ${ getImportanceFn }( second, origin );
					let total = firstImportance + secondImportance;
					if ( total <= 0.0 ) {

						return 0.0;

					}

					if ( leaf < second ) {

						node = first;
						pickPdf *= firstImportance / total;

					} else {

						node = second;
						pickPdf *= secondImportance / total;

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
