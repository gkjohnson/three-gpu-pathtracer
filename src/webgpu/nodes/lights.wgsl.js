import { wgslFn } from 'three/tsl';
import { constants, lightStruct, lightRecordStruct } from './structs.wgsl.js';

// Light type tags ( matching LightsInfoUniformStruct's packing ) and a stand-in "infinite" hit
// distance. Plain JS constants interpolated straight into the WGSL templates - no const block.
// The environment is treated as an additional light kind so env + analytic lights share one NEE path.
export const RECT_AREA_LIGHT_TYPE = 0;
export const CIRC_AREA_LIGHT_TYPE = 1;
export const SPOT_LIGHT_TYPE = 2;
export const DIR_LIGHT_TYPE = 3;
export const POINT_LIGHT_TYPE = 4;
export const ENVIRONMENT_LIGHT_TYPE = 5;
export const LIGHT_FAR_DISTANCE = 1e30;

// which light kinds can also be bsdf-sampled, so their NEE contribution must be MIS-weighted. Punctual
// lights ( spot / point / directional ) can't be hit by a bsdf ray, so they take full weight.
export const isMISWeightLightFn = wgslFn( /* wgsl */ `

	fn isMISWeightLight( lightType: i32 ) -> bool {

		return lightType == ${ ENVIRONMENT_LIGHT_TYPE } || lightType == ${ CIRC_AREA_LIGHT_TYPE } || lightType == ${ RECT_AREA_LIGHT_TYPE };

	}

` );

export const getSpotAttenuationFn = wgslFn( /* wgsl */ `

	fn getSpotAttenuation( coneCosine: f32, penumbraCosine: f32, angleCosine: f32 ) -> f32 {

		return smoothstep( coneCosine, penumbraCosine, angleCosine );

	}

` );

export const getDistanceAttenuationFn = wgslFn( /* wgsl */ `

	fn getDistanceAttenuation( lightDistance: f32, cutoffDistance: f32, decayExponent: f32 ) -> f32 {

		// based upon Frostbite 3 Moving to Physically-based Rendering
		// https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf
		var distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), EPSILON );
		if ( cutoffDistance > 0.0 ) {

			let window = clamp( 1.0 - pow( lightDistance / cutoffDistance, 4.0 ), 0.0, 1.0 );
			distanceFalloff *= window * window;

		}

		return distanceFalloff;

	}

`, [ constants ] );

// Ray/plane intersection constrained to a rectangle centered at "center" spanned by u, v.
// Returns the hit distance along the ray, or a negative value when there is no hit.
export const intersectsRectangleFn = wgslFn( /* wgsl */ `

	fn intersectsRectangle( center: vec3f, normal: vec3f, u: vec3f, v: vec3f, rayOrigin: vec3f, rayDirection: vec3f ) -> f32 {

		let t = dot( center - rayOrigin, normal ) / dot( rayDirection, normal );
		if ( t > EPSILON ) {

			let p = rayOrigin + rayDirection * t;
			let vi = p - center;

			let a1 = dot( u, vi );
			if ( abs( a1 ) <= 0.5 ) {

				let a2 = dot( v, vi );
				if ( abs( a2 ) <= 0.5 ) {

					return t;

				}

			}

		}

		return - 1.0;

	}

`, [ constants ] );

// Ray/plane intersection constrained to a circle centered at "position" spanned by u, v.
// Returns the hit distance along the ray, or a negative value when there is no hit.
export const intersectsCircleFn = wgslFn( /* wgsl */ `

	fn intersectsCircle( position: vec3f, normal: vec3f, u: vec3f, v: vec3f, rayOrigin: vec3f, rayDirection: vec3f ) -> f32 {

		let t = dot( position - rayOrigin, normal ) / dot( rayDirection, normal );
		if ( t > EPSILON ) {

			let hit = rayOrigin + rayDirection * t;
			let vi = hit - position;

			let a1 = dot( u, vi );
			let a2 = dot( v, vi );
			if ( length( vec2f( a1, a2 ) ) <= 0.5 ) {

				return t;

			}

		}

		return - 1.0;

	}

`, [ constants ] );

// Samples a random point on a rectangular or circular area light and forms the LightRecord.
export const randomAreaLightSampleFn = wgslFn( /* wgsl */ `

	fn randomAreaLightSample( light: Light, rayOrigin: vec3f, ruv: vec2f ) -> LightRecord {

		var randomPos = vec3f( 0.0 );
		if ( light.lightType == ${ RECT_AREA_LIGHT_TYPE } ) {

			randomPos = light.position + light.u * ( ruv.x - 0.5 ) + light.v * ( ruv.y - 0.5 );

		} else if ( light.lightType == ${ CIRC_AREA_LIGHT_TYPE } ) {

			let r = 0.5 * sqrt( ruv.x );
			let theta = ruv.y * 2.0 * PI;
			randomPos = light.position + light.u * ( r * cos( theta ) ) + light.v * ( r * sin( theta ) );

		}

		let toLight = randomPos - rayOrigin;
		let lightDistSq = dot( toLight, toLight );
		let dist = sqrt( lightDistSq );
		let direction = toLight / dist;
		let lightNormal = normalize( cross( light.u, light.v ) );

		var lightRec: LightRecord;
		lightRec.lightType = light.lightType;
		lightRec.emission = light.color * light.intensity;
		lightRec.dist = dist;
		lightRec.direction = direction;

		// TODO: the denominator is potentially zero
		lightRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

		return lightRec;

	}

`, [ lightStruct, lightRecordStruct, constants ] );

// Samples the disc of a spot light with distance falloff. Angular ( cone or IES ) attenuation is applied by the caller.
export const randomSpotLightSampleFn = wgslFn( /* wgsl */ `

	fn randomSpotLightSample( light: Light, rayOrigin: vec3f, ruv: vec2f ) -> LightRecord {

		let radius = light.radius * sqrt( ruv.x );
		let theta = ruv.y * 2.0 * PI;
		let x = radius * cos( theta );
		let y = radius * sin( theta );

		let u = light.u;
		let v = light.v;
		let normal = normalize( cross( u, v ) );

		let angle = acos( light.coneCos );
		let angleTan = tan( angle );
		let startDistance = light.radius / max( angleTan, EPSILON );

		let randomPos = light.position - normal * startDistance + u * x + v * y;
		let toLight = randomPos - rayOrigin;
		let lightDistSq = dot( toLight, toLight );
		let dist = sqrt( lightDistSq );

		let direction = toLight / max( dist, EPSILON );
		let distanceAttenuation = getDistanceAttenuation( dist, light.distance, light.decay );

		var lightRec: LightRecord;
		lightRec.lightType = light.lightType;
		lightRec.dist = dist;
		lightRec.direction = direction;
		lightRec.emission = light.color * light.intensity * distanceAttenuation;
		lightRec.pdf = 1.0;

		return lightRec;

	}

`, [ lightStruct, lightRecordStruct, constants, getDistanceAttenuationFn ] );
