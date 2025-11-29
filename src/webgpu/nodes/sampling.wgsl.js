import { wgslFn } from 'three/tsl';
import { pcgRand2 } from './random.wgsl.js';
import { scatterRecordStruct, constants } from './structs.wgsl.js';

// TODO: Move to a local (s, t, n) coordinate system
// From RayTracingGems v1.9 chapter 16.6.2 -- Its shit!
// https://www.realtimerendering.com/raytracinggems/unofficial_RayTracingGems_v1.9.pdf
// result.xyz = cosine-wighted vector on the hemisphere oriented to a vector
// result.w = pdf
export const sampleSphereCosineFn = wgslFn( /* wgsl */ `
	fn sampleSphereCosine(rng: vec2f, n: vec3f) -> vec4f {

		let a = (1 - 2 * rng.x) * 0.99999;
		let b = sqrt( 1 - a * a ) * 0.99999;
		let phi = 2 * PI * rng.y;
		let direction = normalize( vec3f(n.x + b * cos( phi ), n.y + b * sin( phi ), n.z + a) );
		let pdf = dot( direction, n ) / PI;

		return vec4f( direction, pdf );
	}
`, [ constants ] );


export const lambertBsdfFunc = wgslFn( /* wgsl */`
	fn bsdfEval(normal: vec3f, view: vec3f) -> ScatterRecord {

		var record: ScatterRecord;

		// Return bsdfValue / pdf, not bsdfValue and pdf separatly?
		let res = sampleSphereCosine( pcgRand2(), normal );
		record.direction = res.xyz;
		record.pdf = res.w;
		record.value = dot( record.direction, normal ) / PI;

		return record;

	}
`, [ scatterRecordStruct, sampleSphereCosineFn, pcgRand2, constants ] );

// const equirectDirectionToUvFn = wgslFn( /* wgsl */`
// 	fn equirectDirectionToUv(direction: vec3f) -> vec2f {
//
// 		// from Spherical.setFromCartesianCoords
// 		vec2 uv = vec2f( atan2( direction.z, direction.x ), acos( direction.y ) );
// 		uv /= vec2f( 2.0 * PI, PI );
//
// 		// apply adjustments to get values in range [0, 1] and y right side up
// 		uv.x += 0.5;
// 		uv.y = 1.0 - uv.y;
// 		return uv;
//
// 	}
// ` );

// const sampleEquirectColorFn = wgslFn( /* wgsl */ `
// 	fn sampleEquirectColor( envMap: texture_2d<f32>, envMapSampler: sampler, direction: vec3f ) -> vec3f {

// 		return texture2D( envMap, equirectDirectionToUv( direction ) ).rgb;

// 	}
// `, [ equirectDirectionToUvFn ] );
