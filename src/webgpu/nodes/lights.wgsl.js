import { wgslFn } from 'three/tsl';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { lightRecordStruct, constants } from './structs.wgsl.js';

export const LIGHT_TYPE_SPOT = 0;
export const LIGHT_TYPE_DIRECTIONAL = 1;
export const LIGHT_TYPE_POINT = 2;
export const LIGHT_TYPE_AREA_RECT = 3;
export const LIGHT_TYPE_AREA_CIRC = 4;
export const LIGHT_TYPE_ENVIRONMENT = 5;

export const getSpotAttenuationFunc = wgslFn( /* wgsl */`

	fn getSpotAttenuation( coneCosine: f32, penumbraCosine: f32, angleCosine: f32 ) -> f32 {

		return smoothstep( coneCosine, penumbraCosine, angleCosine );

	}

` );

const pow2 = wgslFn( /* wgsl */`
	fn pow2( x: f32 ) -> f32 {
		return x * x;
	}
` );

const pow4 = wgslFn( /* wgsl */`
	fn pow4( x: f32 ) -> f32 {
		return x * x * x * x;
	}
` );

export const getDistanceAttenuationFunc = wgslFn( /* wgsl */`

	fn getDistanceAttenuation( lightDistance: f32, cutoffDistance: f32, decayExponent: f32 ) -> f32 {

		var distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), EPSILON );

		if ( cutoffDistance > 0.0 ) {

			distanceFalloff *= pow2( 1.0 - pow4( lightDistance / cutoffDistance ) );

		}

		return distanceFalloff;

	}

`, [ constants, pow2, pow4 ] );

export const randomAreaLightSampleFunc = wgslTagFn/* wgsl */`
	${ [ constants ] }

	fn randomAreaLightSample( light: Light, rayOrigin: vec3f, ruv: vec2f ) -> ${ lightRecordStruct } {

		var randomPos: vec3f;
		if ( light.kind == ${ LIGHT_TYPE_AREA_RECT } ) {

			randomPos = light.position + light.u * ( ruv.x - 0.5 ) + light.v * ( ruv.y - 0.5 );

		} else if ( light.kind == ${ LIGHT_TYPE_AREA_CIRC } ) {

			let r = 0.5 * sqrt( ruv.x );
			let theta = ruv.y * 2.0 * PI;
			let x = r * cos( theta );
			let y = r * sin( theta );

			randomPos = light.position + light.u * x + light.v * y;

		}

		let toLight = randomPos - rayOrigin;
		let lightDistSq = dot( toLight, toLight );
		let dist = sqrt( lightDistSq );
		let direction = toLight / dist;
		let lightNormal = normalize( cross( light.u, light.v ) );

		var lightRec: ${ lightRecordStruct };
		lightRec.kind = light.kind;
		lightRec.emission = light.color * light.intensity;
		lightRec.dist = dist;
		lightRec.direction = direction;

		lightRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

		return lightRec;

	}

`;

export const randomSpotLightSampleFunc = wgslTagFn/* wgsl */`
	${ [ constants ] }

	fn randomSpotLightSample(
		light: Light, rayOrigin: vec3f, ruv: vec2f,
		iesProfiles: texture_2d_array<f32>, iesProfilesSampler: sampler
	) -> ${ lightRecordStruct } {

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
		let cosTheta = dot( direction, normal );

		var spotAttenuation: f32;

		if ( light.iesProfile >= 0 ) {

			let angle = acos( cosTheta ) / PI;

			spotAttenuation = textureSampleLevel( iesProfiles, iesProfilesSampler, vec2f( angle, 0.0 ), light.iesProfile, 0.0 ).r;

		} else {

			spotAttenuation = ${ getSpotAttenuationFunc }( light.coneCos, light.penumbraCos, cosTheta );

		}

		let distanceAttenuation = ${ getDistanceAttenuationFunc }( dist, light.distance, light.decay );
		var lightRec: ${ lightRecordStruct };
		lightRec.kind = light.kind;
		lightRec.dist = dist;
		lightRec.direction = direction;
		lightRec.emission = light.color * light.intensity * distanceAttenuation * spotAttenuation;
		lightRec.pdf = 1.0;

		return lightRec;

	}

`;

export const sampleRandomLightFunc = ( lights ) => wgslTagFn/* wgsl */`
	fn randomLightSample(
		lightType: f32, lightUV: vec2f, lightCount: u32, rayOrigin: vec3f,
		iesProfiles: texture_2d_array<f32>, iesProfilesSampler: sampler
	) -> ${ lightRecordStruct } {

		var result: ${ lightRecordStruct };

		let lightIndex = u32( lightType * f32( lightCount ) );
		let light = ${ lights }[ lightIndex ];

		if ( light.kind == ${ LIGHT_TYPE_SPOT } ) {

			result = ${ randomSpotLightSampleFunc }( light, rayOrigin, lightUV, iesProfiles, iesProfilesSampler );

		} else if ( light.kind == ${ LIGHT_TYPE_POINT } ) {

			let lightRay = light.u - rayOrigin;
			let lightDist = length( lightRay );
			let cutoffDistance = light.distance;
			var distanceFalloff = 1.0 / max( pow( lightDist, light.decay ), 0.01 );
			if ( cutoffDistance > 0.0 ) {

				distanceFalloff *= ${ pow2 }( saturate( 1.0 - ${ pow4 }( lightDist / cutoffDistance ) ) );

			}

			var rec: ${ lightRecordStruct };
			rec.direction = normalize( lightRay );
			rec.dist = lightDist;
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity * distanceFalloff;
			rec.kind = light.kind;
			result = rec;

		} else if ( light.kind == ${ LIGHT_TYPE_DIRECTIONAL } ) {

			var rec: ${ lightRecordStruct };
			rec.dist = 1e10;
			rec.direction = light.u;
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity;
			rec.kind = light.kind;

			result = rec;

		} else {

			result = ${ randomAreaLightSampleFunc }( light, rayOrigin, lightUV );

		}

		return result;

	}

`;

