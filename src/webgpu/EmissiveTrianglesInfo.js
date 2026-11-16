import { texture, uniform } from 'three/tsl';
import { Matrix4, Vector3, RedFormat, RGIntegerFormat, FloatType, UnsignedIntType } from 'three/webgpu';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { LinearDataTexture } from './LinearDataTexture.js';
import { searchCdfFn } from './nodes/cdf.wgsl.js';
import { lightRecordStruct } from './nodes/structs.wgsl.js';
import { luminanceFn } from './nodes/sampling.wgsl.js';
import { EMISSIVE_TRIANGLE_LIGHT_TYPE } from './nodes/lights.wgsl.js';

// the words of an object's transform read here, after its two matrices
const TRANSFORM_VISIBLE_WORD = 32;
const TRANSFORM_MATERIAL_WORD = 33;

const _matrix = /* @__PURE__ */ new Matrix4();
const _a = /* @__PURE__ */ new Vector3();
const _b = /* @__PURE__ */ new Vector3();
const _c = /* @__PURE__ */ new Vector3();
const _edge1 = /* @__PURE__ */ new Vector3();
const _edge2 = /* @__PURE__ */ new Vector3();

// The scene's emissive triangles as lights, picked in proportion to their power, world area times the luminance
// of their material's constant emission. Emissive textures only shade the sampled point, as in Cycles, mutracer
// and vk_gltf_renderer. Two textures hold them:
// - "emissiveCdf": the CDF of their power, led by a zero so a triangle's range is two neighboring entries.
// - "emissiveTriangles": each triangle's object index and triangle index, to read its vertices from the bvh's
//   geometry and its transform and material from the object.
export class EmissiveTrianglesInfo {

	constructor() {

		this.countNode = uniform( 0, 'uint' );
		this.totalWeightNode = uniform( 0 );
		this.cdfTextureNode = texture( new LinearDataTexture( new Float32Array( [ 0, 1 ] ), 1, RedFormat, FloatType ) ).setName( 'emissiveCdf' );
		this.trianglesNode = texture( new LinearDataTexture( new Uint32Array( 2 ), 2, RGIntegerFormat, UnsignedIntType ) ).setName( 'emissiveTriangles' );

		this._initFns();

	}

	// Collects the emissive triangles from each object's triangle range in the bvh data. Call after the materials
	// are written to the shading model, and after objects move since the weights use world areas
	update( bvhData, shadingModel ) {

		const { storage: bvhStorage, structs, triangleRanges } = bvhData;
		const index = bvhStorage.index.proxyNode.value.array;
		const attributes = new Float32Array( bvhStorage.attributes.proxyNode.value.array.buffer );
		const transformsU32 = bvhStorage.transforms.proxyNode.value.array;
		const transformsF32 = new Float32Array( transformsU32.buffer, transformsU32.byteOffset, transformsU32.length );

		// every geometry member is a vec4f
		const attributeStride = structs.attributes.getLength();
		const positionOffset = structs.attributes.membersLayout.findIndex( ( { name } ) => name === 'position' ) * 4;
		const transformStride = structs.transform.getLength();

		// each emissive triangle's weight, and its object and triangle index
		const weights = [];
		const triangles = [];
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

			_matrix.fromArray( transformsF32, slot );
			for ( let t = offset; t < offset + count; t ++ ) {

				_a.fromArray( attributes, index[ t * 3 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_b.fromArray( attributes, index[ t * 3 + 1 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_c.fromArray( attributes, index[ t * 3 + 2 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				const area = 0.5 * _edge1.subVectors( _b, _a ).cross( _edge2.subVectors( _c, _a ) ).length();
				if ( area > 0 ) {

					weights.push( area * luminance );
					triangles.push( objectIndex, t );

				}

			}

		} );

		// the CDF, summed in double precision and ending at exactly one
		const count = weights.length;
		let totalWeight = 0;
		for ( let i = 0; i < count; i ++ ) {

			totalWeight += weights[ i ];

		}

		const cdf = new Float32Array( count + 1 );
		let sum = 0;
		for ( let i = 0; i < count; i ++ ) {

			sum += weights[ i ];
			cdf[ i + 1 ] = sum / totalWeight;

		}

		cdf[ count ] = 1;

		this.cdfTextureNode.value.dispose();
		this.cdfTextureNode.value = new LinearDataTexture( cdf, 1, RedFormat, FloatType );
		this.trianglesNode.value.dispose();
		this.trianglesNode.value = new LinearDataTexture( new Uint32Array( count > 0 ? triangles : [ 0, 0 ] ), 2, RGIntegerFormat, UnsignedIntType );

		this.countNode.value = count;
		this.totalWeightNode.value = totalWeight;

	}

	_initFns() {

		const { cdfTextureNode, trianglesNode, countNode, totalWeightNode } = this;
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

		// Samples a point on an emissive triangle picked by searching the CDF for "ruv.x", uniformly over its area
		// from "ruv.yz", as seen from "position". The pdf, over solid angle, includes the pick's: the triangle's
		// area cancels out of it, leaving its material's luminance over the total power. Zero for a point on a
		// side of the triangle its material doesn't emit from
		this.sample = wgslTagFn/* wgsl */`
			fn sampleEmissiveTriangle( position: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				var lightRec: ${ lightRecordStruct };

				// the picked triangle's object, material and world space vertices
				var fraction = 0.0;
				let entry = ${ searchCdfFn }( ${ cdfTextureNode }, ruv.x, 0u, ${ countNode }, &fraction );
				let width = textureDimensions( ${ trianglesNode } ).x;
				let ids = textureLoad( ${ trianglesNode }, vec2u( entry % width, entry / width ), 0 ).xy;
				let objectInfo = &${ transformsStorage }[ ids.x ];
				let materialInfo = &${ materialsStorage }[ objectInfo.materialIndex ];

				let i0 = ${ indexStorage }[ ids.y * 3u ];
				let i1 = ${ indexStorage }[ ids.y * 3u + 1u ];
				let i2 = ${ indexStorage }[ ids.y * 3u + 2u ];
				let p0 = ( objectInfo.matrixWorld * vec4f( ${ attributesStorage }[ i0 ].position.xyz, 1.0 ) ).xyz;
				let p1 = ( objectInfo.matrixWorld * vec4f( ${ attributesStorage }[ i1 ].position.xyz, 1.0 ) ).xyz;
				let p2 = ( objectInfo.matrixWorld * vec4f( ${ attributesStorage }[ i2 ].position.xyz, 1.0 ) ).xyz;

				// a uniform point by area
				let su = sqrt( ruv.y );
				let b0 = 1.0 - su;
				let b1 = ruv.z * su;
				let b2 = 1.0 - b0 - b1;
				let point = b0 * p0 + b1 * p1 + b2 * p2;

				let toLight = point - position;
				let distSq = dot( toLight, toLight );
				let normal = normalize( cross( p1 - p0, p2 - p0 ) );
				let direction = toLight * inverseSqrt( distSq );

				// the side the light leaves from, front, back or either by the material's side
				let cosLight = - dot( normal, direction );
				let facing = select( cosLight * materialInfo.side, abs( cosLight ), materialInfo.side == 0.0 );
				if ( distSq <= 0.0 || facing <= 0.0 ) {

					return lightRec;

				}

				var emission = materialInfo.emissiveIntensity * materialInfo.emissive;
				if ( materialInfo.emissiveMap != - 1 ) {

					let uv0 = ${ getUvFromChannel }( ${ attributesStorage }[ i0 ], materialInfo.emissiveMap );
					let uv1 = ${ getUvFromChannel }( ${ attributesStorage }[ i1 ], materialInfo.emissiveMap );
					let uv2 = ${ getUvFromChannel }( ${ attributesStorage }[ i2 ], materialInfo.emissiveMap );
					let uv = b0 * uv0 + b1 * uv1 + b2 * uv2;
					let uvPrime = materialInfo.emissiveMapTransform * vec3f( uv, 1.0 );
					emission *= ${ sampleTexel }( uvPrime.xy, materialInfo.emissiveMap, 0.0 ).rgb;

				}

				lightRec.dist = sqrt( distSq );
				lightRec.direction = direction;
				lightRec.emission = emission;
				lightRec.pdf = ${ luminanceFn }( materialInfo.emissiveIntensity * materialInfo.emissive ) / ${ totalWeightNode } * distSq / facing;
				lightRec.lightType = ${ EMISSIVE_TRIANGLE_LIGHT_TYPE };
				return lightRec;

			}
		`;

		// The pdf "sampleEmissiveTriangle" samples a point a ray from "origin" hits at "position" on an object's
		// triangle with, facing "normal", or zero when the object's material doesn't emit
		this.getPdf = wgslTagFn/* wgsl */`
			fn getEmissiveTrianglePdf( origin: vec3f, position: vec3f, normal: vec3f, objectIndex: u32 ) -> f32 {

				if ( ${ countNode } == 0u ) {

					return 0.0;

				}

				let materialInfo = &${ materialsStorage }[ ${ transformsStorage }[ objectIndex ].materialIndex ];
				let luminance = ${ luminanceFn }( materialInfo.emissiveIntensity * materialInfo.emissive );
				let toHit = position - origin;
				let distSq = dot( toHit, toHit );
				let cosLight = abs( dot( normal, toHit ) ) * inverseSqrt( distSq );
				if ( luminance <= 0.0 || distSq <= 0.0 || cosLight <= 0.0 ) {

					return 0.0;

				}

				return luminance / ${ totalWeightNode } * distSq / cosLight;

			}
		`;

	}

	dispose() {

		this.cdfTextureNode.value.dispose();
		this.trianglesNode.value.dispose();

	}

}
