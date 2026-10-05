import { storage, uniform, uniformArray, texture } from 'three/tsl';
import { StorageBufferAttribute, HalfFloatType } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { AtlasTexture } from './AtlasTexture.js';
import { LightsInfoUniformStruct, VISIBLE_TO_CAMERA_OFFSET } from '../uniforms/LightsInfoUniformStruct.js';
import { lightStruct, lightRecordStruct } from './nodes/structs.wgsl.js';
import { sampleTexelFunc } from './nodes/utils.wgsl.js';
import { luminanceFn } from './nodes/sampling.wgsl.js';
import {
	RECT_AREA_LIGHT_TYPE,
	CIRC_AREA_LIGHT_TYPE,
	SPOT_LIGHT_TYPE,
	DIR_LIGHT_TYPE,
	POINT_LIGHT_TYPE,
	LIGHT_FAR_DISTANCE,
	LIGHT_SELECTION_UNIFORM_SHARE,
	intersectsRectangleFn,
	intersectsCircleFn,
	randomAreaLightSampleFn,
	randomSpotLightSampleFn,
	getSpotAttenuationFn,
	getDistanceAttenuationFn,
	lightSelectionPdfFn,
} from './nodes/lights.wgsl.js';

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
		this.iesInfoNode = uniformArray( this.iesAtlas.textureInfo, 'uvec4' );

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

		// rewrite the int fields ( lightType, visibleToCamera, iesProfile ) as i32 bits
		const intView = new Int32Array( this.buffer.array.buffer );
		for ( let i = 0; i < count; i ++ ) {

			const base = i * stride;
			intView[ base + 3 ] = Math.round( src[ base + 3 ] );
			intView[ base + VISIBLE_TO_CAMERA_OFFSET ] = Math.round( src[ base + VISIBLE_TO_CAMERA_OFFSET ] );
			intView[ base + 21 ] = Math.round( src[ base + 21 ] );

		}

		this.buffer.needsUpdate = true;
		this.countNode.value = this.count;

		return changed;

	}

	_initFns() {

		const { bufferNode, countNode, iesProfilesNode, iesInfoNode } = this;

		// profiles are sampled out of an atlas so filtering must resolve tile-relative wrapping
		const sampleIesTexelFn = sampleTexelFunc( iesInfoNode, iesProfilesNode, 'sampleIesTexel' );

		this.isLightVisibleToCamera = wgslTagFn/* wgsl */`
			fn isLightVisibleToCamera( index: u32 ) -> bool {

				return ${ bufferNode }[ index ].visibleToCamera != 0;

			}
		`;

		// A cheap estimate of how much light reaches a position from a light, ignoring occlusion and
		// the surface orientation, used to choose which light to sample.
		this.getLightWeight = wgslTagFn/* wgsl */`
			fn getLightWeight( index: u32, position: vec3f ) -> f32 {

				let light = ${ bufferNode }[ index ];
				let power = ${ luminanceFn }( light.color * light.intensity );
				if ( light.lightType == ${ DIR_LIGHT_TYPE } ) {

					return power;

				}

				if ( light.lightType == ${ POINT_LIGHT_TYPE } ) {

					// the point light's world position is packed into the u slot
					let dist = length( light.u - position );
					return power * ${ getDistanceAttenuationFn }( dist, light.distance, light.decay );

				}

				let toLight = light.position - position;
				let distSq = dot( toLight, toLight );
				if ( distSq == 0.0 ) {

					return 0.0;

				}

				let normal = normalize( cross( light.u, light.v ) );
				let cosTheta = dot( toLight, normal ) * inverseSqrt( distSq );
				if ( light.lightType == ${ SPOT_LIGHT_TYPE } ) {

					// ies profiles are not evaluated here
					var attenuation = 1.0;
					if ( light.iesProfile < 0 ) {

						attenuation = ${ getSpotAttenuationFn }( light.coneCos, light.penumbraCos, cosTheta );

					}

					return power * attenuation * ${ getDistanceAttenuationFn }( sqrt( distSq ), light.distance, light.decay );

				}

				// area lights only emit from their front face, and the distance is held above the size
				// of the light so positions on or near it do not dominate
				return power * light.area * max( cosTheta, 0.0 ) / max( distSq, light.area );

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

		// Chooses a light, or the environment when the returned index equals the light count, in
		// proportion to the estimated weights with a uniform share mixed in. "optionCount" is the
		// light count plus one when the environment can be chosen.
		this.selectLight = wgslTagFn/* wgsl */`
			fn selectLight( position: vec3f, envWeight: f32, optionCount: f32, r: f32, selectionPdf: ptr<function, f32> ) -> u32 {

				let count = ${ countNode };
				let totalWeight = ${ this.getLightsWeight }( position ) + envWeight;

				var index = count;
				if ( totalWeight <= 0.0 || r < ${ LIGHT_SELECTION_UNIFORM_SHARE } ) {

					let uniformR = select( r / ${ LIGHT_SELECTION_UNIFORM_SHARE }, r, totalWeight <= 0.0 );
					index = min( u32( uniformR * optionCount ), u32( optionCount ) - 1u );

				} else {

					let targetWeight = ( r - ${ LIGHT_SELECTION_UNIFORM_SHARE } ) / ( 1.0 - ${ LIGHT_SELECTION_UNIFORM_SHARE } ) * totalWeight;
					var accumulated = 0.0;
					for ( var i = 0u; i < count; i ++ ) {

						accumulated += ${ this.getLightWeight }( i, position );
						if ( targetWeight < accumulated ) {

							index = i;
							break;

						}

					}

					// rounding can carry the target past the last light when there is no environment
					if ( index == count && envWeight <= 0.0 ) {

						index = count - 1u;

					}

				}

				var weight = envWeight;
				if ( index < count ) {

					weight = ${ this.getLightWeight }( index, position );

				}

				*selectionPdf = ${ lightSelectionPdfFn }( weight, totalWeight, optionCount );
				return index;

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
		this.iesAtlas.dispose();

	}

}
