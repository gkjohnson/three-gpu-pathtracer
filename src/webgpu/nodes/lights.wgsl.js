import { wgslFn } from 'three/tsl';
import { rayStruct } from 'three-mesh-bvh/webgpu';
import { constants, lightStruct, lightRecordStruct } from './structs.wgsl.js';
import { offsetRayOriginFunc } from './utils.wgsl.js';

// Light type tags matching LightsInfoUniformStruct's packing. The environment is treated as an
// additional light kind so env + analytic lights share one NEE path.
export const RECT_AREA_LIGHT_TYPE = 0;
export const CIRC_AREA_LIGHT_TYPE = 1;
export const SPOT_LIGHT_TYPE = 2;
export const DIR_LIGHT_TYPE = 3;
export const POINT_LIGHT_TYPE = 4;
export const ENVIRONMENT_LIGHT_TYPE = 5;
export const EMISSIVE_TRIANGLE_LIGHT_TYPE = 6;
export const LIGHT_FAR_DISTANCE = 1e30;

// Writes the direction and distance to a point sampled on a light. The point is offset from the light's surface so shadow
// rays don't hit it
export const writeLightPointFn = wgslFn( /* wgsl */ `

	fn writeLightPoint( lightRec: ptr<function, LightRecord>, rayOrigin: vec3f, lightPoint: vec3f, lightNormal: vec3f ) -> void {

		let toLight = offsetRayOrigin( lightPoint, rayOrigin - lightPoint, lightNormal ) - rayOrigin;
		lightRec.dist = length( toLight );
		lightRec.direction = toLight / max( lightRec.dist, EPSILON );

	}

`, [ lightRecordStruct, offsetRayOriginFunc, constants ] );

// Writes "outRay", the shadow ray toward a light sampled from "hitPoint", the light "lightDist" away in
// "lightDirection". The ray starts at the hit point offset off its surface along "hitNormal", or at the hit point
// itself when the normal is zero, as for a scatter event in fog, and ends at the sampled light point
export const getShadowRayFn = wgslFn( /* wgsl */ `

	fn getShadowRay( hitPoint: vec3f, hitNormal: vec3f, lightDirection: vec3f, lightDist: f32, outRay: ptr<function, Ray> ) -> void {

		var rayStart = hitPoint;
		if ( any( hitNormal != vec3f( 0.0 ) ) ) {

			rayStart = offsetRayOrigin( hitPoint, lightDirection, hitNormal );

		}

		outRay.origin = rayStart;
		outRay.direction = lightDirection;
		outRay.maxDist = lightDist;

		// lights at infinity have no point to end at
		if ( lightDist < ${ LIGHT_FAR_DISTANCE } ) {

			// shorten the ray slightly since over long distances the float error is larger than the light point's offset
			let toLight = hitPoint + lightDirection * lightDist - rayStart;
			let dist = length( toLight );
			outRay.maxDist = dist * ( 1.0 - 1.0 / 65536.0 );
			outRay.direction = toLight / dist;

		}

	}

`, [ rayStruct, offsetRayOriginFunc ] );

// light kinds that are also bsdf-sampled and so take MIS-weighted NEE - punctual lights take full weight
export const isMISWeightLightFn = wgslFn( /* wgsl */ `

	fn isMISWeightLight( lightType: i32 ) -> bool {

		return lightType == ${ ENVIRONMENT_LIGHT_TYPE } ||
			lightType == ${ CIRC_AREA_LIGHT_TYPE } ||
			lightType == ${ RECT_AREA_LIGHT_TYPE } ||
			lightType == ${ EMISSIVE_TRIANGLE_LIGHT_TYPE };

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
		writeLightPoint( &lightRec, rayOrigin, randomPos, lightNormal );

		// points behind or edge-on to the light receive no contribution
		let cosTheta = dot( direction, lightNormal );
		if ( cosTheta <= 0.0 ) {

			lightRec.pdf = 0.0;

		} else {

			lightRec.pdf = lightDistSq / ( light.area * cosTheta );

		}

		return lightRec;

	}

`, [ lightStruct, lightRecordStruct, constants, writeLightPointFn ] );

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
		let dist = length( randomPos - rayOrigin );
		let distanceAttenuation = getDistanceAttenuation( dist, light.distance, light.decay );

		var lightRec: LightRecord;
		lightRec.lightType = light.lightType;
		writeLightPoint( &lightRec, rayOrigin, randomPos, normal );
		lightRec.emission = light.color * light.intensity * distanceAttenuation;
		lightRec.pdf = 1.0;

		return lightRec;

	}

`, [ lightStruct, lightRecordStruct, constants, getDistanceAttenuationFn, writeLightPointFn ] );

// The cosine to the spot axis and the distance from a position to the nearest point on the spot
// light's disc, where the disc lights the position the most
export const getSpotLightNearestFn = wgslFn( /* wgsl */ `

	fn getSpotLightNearest( light: Light, position: vec3f ) -> vec2f {

		let normal = normalize( cross( light.u, light.v ) );
		let startDistance = light.radius / max( tan( acos( light.coneCos ) ), EPSILON );
		let discCenter = light.position - normal * startDistance;

		let toPosition = position - discCenter;
		let along = dot( toPosition, - normal );
		let across = max( length( toPosition + normal * along ) - light.radius, 0.0 );
		let dist = length( vec2f( along, across ) );
		return vec2f( along / max( dist, EPSILON ), dist );

	}

`, [ lightStruct, constants ] );
