import { storage, uniform, uniformArray, texture } from 'three/tsl';
import { StorageBufferAttribute, HalfFloatType, Vector4 } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { AtlasTexture } from './AtlasTexture.js';
import { LightsInfoUniformStruct } from '../uniforms/LightsInfoUniformStruct.js';
import { lightStruct, lightRecordStruct } from './nodes/structs.wgsl.js';
import { sampleTexelFunc } from './nodes/utils.wgsl.js';
import { luminanceFn } from './nodes/sampling.wgsl.js';
import {
	RECT_AREA_LIGHT_TYPE,
	CIRC_AREA_LIGHT_TYPE,
	SPOT_LIGHT_TYPE,
	DIR_LIGHT_TYPE,
	POINT_LIGHT_TYPE,
	EMISSIVE_LIGHT_TYPE,
	LIGHT_FAR_DISTANCE,
	intersectsRectangleFn,
	intersectsCircleFn,
	randomAreaLightSampleFn,
	randomSpotLightSampleFn,
	getSpotAttenuationFn,
	getDistanceAttenuationFn,
	getSpotLightNearestFn,
} from './nodes/lights.wgsl.js';

// vec4 items per emissive triangle: the corner and the cumulative share of the power, the two edges,
// with the emitting sides in the second edge's w, and the emitted radiance with the triangle's
// sampling pdf over its area
export const EMISSIVE_TRIANGLE_STRIDE = 4;

// emitting sides of an emissive triangle, by its world space winding
export const EMISSIVE_FRONT_SIDE = 0;
export const EMISSIVE_BACK_SIDE = 1;
export const EMISSIVE_DOUBLE_SIDE = 2;

export class LightsInfoNode extends LightsInfoUniformStruct {

	constructor() {

		super();

		// lights packed into a storage buffer of Light structs
		this.countNode = uniform( this.count, 'uint' );
		this.buffer = new StorageBufferAttribute( new Float32Array( 2 * lightStruct.getLength() ), lightStruct.getLength() );
		this.bufferNode = storage( this.buffer, lightStruct ).toReadOnly().setName( 'lights' );

		// ies profiles packed into an atlas alongside their placement rects
		this.iesAtlas = new AtlasTexture( { type: HalfFloatType } );
		this.iesProfilesNode = texture( this.iesAtlas.texture );
		this.iesInfoNode = uniformArray( this.iesAtlas.textureInfo, 'uvec4' ).setName( 'iesInfo' );

		// the triangles of emissive meshes, sampled as lights in proportion to their power, and the pdf
		// factor of each transform slot that bsdf rays hitting an emitter are weighted with
		this.emissiveCount = 0;
		this.emissiveCountNode = uniform( 0, 'uint' );
		this.emissivePowerNode = uniform( 0 );
		this.emissiveBoundsNode = uniform( new Vector4() );
		this.emissiveBuffer = new StorageBufferAttribute( new Float32Array( 2 * EMISSIVE_TRIANGLE_STRIDE * 4 ), 4 );
		this.emissiveNode = storage( this.emissiveBuffer, 'vec4' ).toReadOnly().setName( 'emissiveTriangles' );
		this.emissiveSlotBuffer = new StorageBufferAttribute( new Float32Array( 2 ), 1 );
		this.emissiveSlotNode = storage( this.emissiveSlotBuffer, 'float' ).toReadOnly().setName( 'emissiveSlots' );

		this._initFns();

	}

	updateFrom( renderer, lights ) {

		// the unique set of ies textures referenced by the lights' "iesMap" fields
		const iesTextures = Array.from( new Set( lights.map( l => l.iesMap ).filter( t => t ) ) );
		const changed = super.updateFrom( lights, iesTextures );

		this.iesAtlas.setTextures( renderer, iesTextures );
		this.iesProfilesNode.value = this.iesAtlas.texture;

		const stride = lightStruct.getLength();
		const count = this.count;
		const capacity = Math.max( count, 2 );

		// resize the buffer to the exact light count, keeping the same binding node
		if ( this.buffer.array.length !== capacity * stride ) {

			this.buffer.dispose();
			this.buffer = new StorageBufferAttribute( new Float32Array( capacity * stride ), stride );
			this.bufferNode.value = this.buffer;

		}

		// the texture's packed float layout already matches lightStruct's std layout, so copy it in
		const src = this.tex.image.data;
		this.buffer.array.set( src.subarray( 0, count * stride ) );

		// rewrite the int fields ( lightType, visibleToCameraRays, iesProfile ) as i32 bits
		const intView = new Int32Array( this.buffer.array.buffer );
		for ( let i = 0; i < count; i ++ ) {

			const base = i * stride;
			intView[ base + 3 ] = Math.round( src[ base + 3 ] );
			intView[ base + 11 ] = Math.round( src[ base + 11 ] );
			intView[ base + 21 ] = Math.round( src[ base + 21 ] );

		}

		this.buffer.needsUpdate = true;
		this.countNode.value = this.count;

		return changed;

	}

	/**
	 * Sets the emissive triangles that next event estimation samples, as built by
	 * "WebGPUPathTracer" from the scene.
	 *
	 * @param {Object} emissive
	 * @param {Float32Array} emissive.triangles - EMISSIVE_TRIANGLE_STRIDE vec4s per triangle.
	 * @param {Float32Array} emissive.slots - The light pdf factor of each transform slot, zero for slots that are not sampled.
	 * @param {number} emissive.count
	 * @param {number} emissive.power - The total power the triangles are sampled by.
	 * @param {Vector4} emissive.bounds - The bounding sphere of the triangles.
	 */
	updateEmissive( { triangles, slots, count, power, bounds } ) {

		// at least two items so TSL keeps the buffers arrays
		const trianglesLength = Math.max( count, 2 ) * EMISSIVE_TRIANGLE_STRIDE * 4;
		if ( this.emissiveBuffer.array.length !== trianglesLength ) {

			this.emissiveBuffer.dispose();
			this.emissiveBuffer = new StorageBufferAttribute( new Float32Array( trianglesLength ), 4 );
			this.emissiveNode.value = this.emissiveBuffer;

		}

		const slotsLength = Math.max( slots.length, 2 );
		if ( this.emissiveSlotBuffer.array.length !== slotsLength ) {

			this.emissiveSlotBuffer.dispose();
			this.emissiveSlotBuffer = new StorageBufferAttribute( new Float32Array( slotsLength ), 1 );
			this.emissiveSlotNode.value = this.emissiveSlotBuffer;

		}

		this.emissiveBuffer.array.fill( 0 );
		this.emissiveBuffer.array.set( triangles.subarray( 0, count * EMISSIVE_TRIANGLE_STRIDE * 4 ) );
		this.emissiveBuffer.needsUpdate = true;

		this.emissiveSlotBuffer.array.fill( 0 );
		this.emissiveSlotBuffer.array.set( slots );
		this.emissiveSlotBuffer.needsUpdate = true;

		this.emissiveCount = count;
		this.emissiveCountNode.value = count;
		this.emissivePowerNode.value = power;
		this.emissiveBoundsNode.value.copy( bounds );

	}

	_initFns() {

		const { bufferNode, countNode, iesProfilesNode, iesInfoNode } = this;
		const { emissiveNode, emissiveSlotNode, emissiveCountNode, emissivePowerNode, emissiveBoundsNode } = this;

		// profiles are sampled out of an atlas so filtering must resolve tile-relative wrapping
		const sampleIesTexelFn = sampleTexelFunc( iesInfoNode, iesProfilesNode, 'sampleIesTexel' );

		this.isLightVisibleToCamera = wgslTagFn/* wgsl */`
			fn isLightVisibleToCamera( index: u32 ) -> bool {

				return ${ bufferNode }[ index ].visibleToCameraRays != 0;

			}
		`;

		// A cheap estimate of how much light reaches a position from a light, ignoring occlusion and
		// the surface orientation, used to choose which light to sample.
		// TODO: weigh lights below the surface's horizon to zero using its normal, skipped for
		// transmissive surfaces. Forward hit MIS would then need the previous vertex's normal too.
		this.getLightWeight = wgslTagFn/* wgsl */`
			fn getLightWeight( index: u32, position: vec3f ) -> f32 {

				let light = ${ bufferNode }[ index ];
				let power = ${ luminanceFn }( light.color * light.intensity );
				if ( light.lightType == ${ SPOT_LIGHT_TYPE } ) {

					// the most any point on the spot's disc lights the position. Ies profiles are not
					// evaluated here
					let nearest = ${ getSpotLightNearestFn }( light, position );
					var attenuation = 1.0;
					if ( light.iesProfile < 0 ) {

						attenuation = ${ getSpotAttenuationFn }( light.coneCos, light.penumbraCos, nearest.x );

					}

					return power * attenuation * ${ getDistanceAttenuationFn }( nearest.y, light.distance, light.decay );

				} else if ( light.lightType == ${ POINT_LIGHT_TYPE } ) {

					// the point light's world position is packed into the u slot
					let dist = length( light.u - position );
					return power * ${ getDistanceAttenuationFn }( dist, light.distance, light.decay );

				} else if ( light.lightType == ${ DIR_LIGHT_TYPE } ) {

					return power;

				} else {

					let toLight = light.position - position;
					let distSq = dot( toLight, toLight );
					if ( distSq == 0.0 ) {

						return 0.0;

					}

					// area lights only emit from their front face, and the distance is held above the size
					// of the light so positions on or near it do not dominate
					let normal = normalize( cross( light.u, light.v ) );
					let cosTheta = dot( toLight, normal ) * inverseSqrt( distSq );
					return power * light.area * max( cosTheta, 0.0 ) / max( distSq, light.area );

				}

			}
		`;

		this.getLightsWeight = wgslTagFn/* wgsl */`
			fn getLightsWeight( position: vec3f ) -> f32 {

				var total = 0.0;
				for ( var i = 0u; i < ${ countNode }; i ++ ) {

					total += ${ this.getLightWeight }( i, position );

				}

				return total;

			}
		`;

		// A cheap estimate of how much light the emissive triangles together send to a position, like
		// "getLightWeight" for an area light the size of their bounding sphere
		this.getEmissiveWeight = wgslTagFn/* wgsl */`
			fn getEmissiveWeight( position: vec3f ) -> f32 {

				if ( ${ emissiveCountNode } == 0u ) {

					return 0.0;

				}

				let bounds = ${ emissiveBoundsNode };
				let toCenter = bounds.xyz - position;
				return ${ emissivePowerNode } / max( dot( toCenter, toCenter ), bounds.w * bounds.w );

			}
		`;

		// Chooses a light, the environment when the returned index equals the light count, or the emissive
		// triangles when it is one past it, in proportion to the estimated weights. The pdf is zero when
		// nothing can light the position.
		this.selectLight = wgslTagFn/* wgsl */`
			fn selectLight( position: vec3f, envWeight: f32, emissiveWeight: f32, r: f32, selectionPdf: ptr<function, f32> ) -> u32 {

				let count = ${ countNode };
				let totalWeight = ${ this.getLightsWeight }( position ) + envWeight + emissiveWeight;
				if ( totalWeight <= 0.0 ) {

					*selectionPdf = 0.0;
					return 0u;

				}

				let targetWeight = r * totalWeight;
				var accumulated = 0.0;
				var lastWeighted = 0u;
				var index = count;
				for ( var i = 0u; i < count; i ++ ) {

					let lightWeight = ${ this.getLightWeight }( i, position );
					accumulated += lightWeight;
					if ( lightWeight > 0.0 ) {

						lastWeighted = i;

					}

					if ( targetWeight < accumulated ) {

						index = i;
						break;

					}

				}

				// past the lights, the environment and then the emissive triangles. Rounding can carry the
				// target past the last weighted choice
				if ( index == count ) {

					if ( emissiveWeight > 0.0 && ( targetWeight >= accumulated + envWeight || envWeight <= 0.0 ) ) {

						index = count + 1u;

					} else if ( envWeight <= 0.0 ) {

						index = lastWeighted;

					}

				}

				var weight = envWeight;
				if ( index < count ) {

					weight = ${ this.getLightWeight }( index, position );

				} else if ( index > count ) {

					weight = emissiveWeight;

				}

				*selectionPdf = weight / totalWeight;
				return index;

			}
		`;

		// Samples a point on an emissive triangle, picked in proportion to its power with the cumulative
		// shares, and returns it as a light record. The pdf is over the solid angle, and zero when the
		// position is behind a one sided emitter
		this.sampleEmissive = wgslTagFn/* wgsl */`
			fn sampleEmissive( position: vec3f, r: vec3f ) -> ${ lightRecordStruct } {

				var lower = 0u;
				var upper = ${ emissiveCountNode } - 1u;
				while ( lower < upper ) {

					let middle = ( lower + upper ) >> 1u;
					if ( ${ emissiveNode }[ middle * ${ EMISSIVE_TRIANGLE_STRIDE }u ].w < r.x ) {

						lower = middle + 1u;

					} else {

						upper = middle;

					}

				}

				let base = lower * ${ EMISSIVE_TRIANGLE_STRIDE }u;
				let corner = ${ emissiveNode }[ base ];
				let edge1 = ${ emissiveNode }[ base + 1u ];
				let edge2 = ${ emissiveNode }[ base + 2u ];
				let emission = ${ emissiveNode }[ base + 3u ];

				// a uniformly distributed point on the triangle
				let s = sqrt( r.y );
				let point = corner.xyz + edge1.xyz * ( s * ( 1.0 - r.z ) ) + edge2.xyz * ( s * r.z );
				let toLight = point - position;
				let distSq = max( dot( toLight, toLight ), 1e-12 );
				let dist = sqrt( distSq );
				let direction = toLight / dist;

				// the cosine at the emitter on its emitting sides
				var cosLight = - dot( normalize( cross( edge1.xyz, edge2.xyz ) ), direction );
				let sides = u32( edge2.w );
				if ( sides == ${ EMISSIVE_BACK_SIDE }u ) {

					cosLight = - cosLight;

				} else if ( sides == ${ EMISSIVE_DOUBLE_SIDE }u ) {

					cosLight = abs( cosLight );

				}

				var result: ${ lightRecordStruct };
				result.lightType = ${ EMISSIVE_LIGHT_TYPE };
				result.direction = direction;
				result.dist = dist;
				result.emission = emission.rgb;
				result.pdf = select( 0.0, emission.w * distSq / cosLight, cosLight > 0.0 );
				return result;

			}
		`;

		// The solid angle pdf of sampling the point a ray from a position hit at the given distance and cosine
		// on the emitter of a transform slot, before choosing the emissive triangles among the lights. Zero for
		// emitters that are not sampled
		this.getEmissiveHitPdf = wgslTagFn/* wgsl */`
			fn getEmissiveHitPdf( slot: u32, dist: f32, cosLight: f32 ) -> f32 {

				return ${ emissiveSlotNode }[ slot ] * dist * dist / max( abs( cosLight ), 1e-6 );

			}
		`;

		// sample the light at the given index
		this.randomLightSample = wgslTagFn/* wgsl */`
			fn randomLightSample( lightIndex: u32, rayOrigin: vec3f, ruv: vec2f ) -> ${ lightRecordStruct } {

				let light = ${ bufferNode }[ lightIndex ];

				var result: ${ lightRecordStruct };
				if ( light.lightType == ${ SPOT_LIGHT_TYPE } ) {

					result = ${ randomSpotLightSampleFn }( light, rayOrigin, ruv );

					let spotNormal = normalize( cross( light.u, light.v ) );
					let cosTheta = dot( result.direction, spotNormal );
					var spotAttenuation: f32;
					if ( light.iesProfile >= 0 ) {

						// half a texel of the profile's tile in the atlas
						let profileInfo = ${ iesInfoNode }[ u32( light.iesProfile ) ];
						let texelInset = 0.5 / vec2f( vec2u( profileInfo.y & 0xFFFFu, profileInfo.y >> 16u ) );

						// tilt spans [ 0, 180 ]deg inset to the texel centers, twist covers [ 0, 359 ]deg and wraps
						let tiltAngle = mix( texelInset.x, 1.0 - texelInset.x, acos( cosTheta ) / PI );
						let twistAngle = ( atan2( dot( result.direction, light.v ), dot( result.direction, light.u ) ) + PI ) / ( 2.0 * PI ) + texelInset.y;
						let packedProfile = ( 1 << 26 ) | light.iesProfile;
						spotAttenuation = ${ sampleIesTexelFn }( vec2f( tiltAngle, twistAngle ), packedProfile, 0.0 ).r;

					} else {

						spotAttenuation = ${ getSpotAttenuationFn }( light.coneCos, light.penumbraCos, cosTheta );

					}

					result.emission *= spotAttenuation;

				} else if ( light.lightType == ${ POINT_LIGHT_TYPE } ) {

					// the point light's world position is packed into the u slot
					let lightRay = light.u - rayOrigin;
					let lightDist = length( lightRay );
					let cutoffDistance = light.distance;
					var distanceFalloff = 1.0 / max( pow( lightDist, light.decay ), 0.01 );
					if ( cutoffDistance > 0.0 ) {

						let window = clamp( 1.0 - pow( lightDist / cutoffDistance, 4.0 ), 0.0, 1.0 );
						distanceFalloff *= window * window;

					}

					result.direction = normalize( lightRay );
					result.dist = lightDist;
					result.pdf = 1.0;
					result.emission = light.color * light.intensity * distanceFalloff;
					result.lightType = light.lightType;

				} else if ( light.lightType == ${ DIR_LIGHT_TYPE } ) {

					// the directional light's direction is packed into the u slot
					result.dist = ${ LIGHT_FAR_DISTANCE };
					result.direction = light.u;
					result.pdf = 1.0;
					result.emission = light.color * light.intensity;
					result.lightType = light.lightType;

				} else {

					result = ${ randomAreaLightSampleFn }( light, rayOrigin, ruv );

				}

				return result;

			}
		`;

		// forward intersection of a ray with a single area light ( rect / circ only ), used for MIS
		// TODO: support hitting the spot light disk here and move spot lights into the
		// MIS-weighted set so they appear in sharp reflections
		this.intersectLightAtIndex = wgslTagFn/* wgsl */`
			fn intersectLightAtIndex( rayOrigin: vec3f, rayDirection: vec3f, index: u32, lightRec: ptr<function, ${ lightRecordStruct }> ) -> bool {

				let light = ${ bufferNode }[ index ];

				var u = light.u;
				var v = light.v;
				let normal = normalize( cross( u, v ) );

				// only front-facing area lights can be hit
				if ( dot( normal, rayDirection ) > 0.0 ) {

					u *= 1.0 / dot( u, u );
					v *= 1.0 / dot( v, v );

					var dist = - 1.0;
					if ( light.lightType == ${ RECT_AREA_LIGHT_TYPE } ) {

						dist = ${ intersectsRectangleFn }( light.position, normal, u, v, rayOrigin, rayDirection );

					} else if ( light.lightType == ${ CIRC_AREA_LIGHT_TYPE } ) {

						dist = ${ intersectsCircleFn }( light.position, normal, u, v, rayOrigin, rayDirection );

					}

					if ( dist > 0.0 ) {

						let cosTheta = dot( rayDirection, normal );
						lightRec.dist = dist;
						lightRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
						lightRec.emission = light.color * light.intensity;
						lightRec.direction = rayDirection;
						lightRec.lightType = light.lightType;
						return true;

					}

				}

				return false;

			}
		`;

	}

	dispose() {

		this.tex.dispose();
		this.buffer.dispose();
		this.emissiveBuffer.dispose();
		this.emissiveSlotBuffer.dispose();
		this.iesAtlas.dispose();

	}

}
