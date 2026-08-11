import { wgslFn } from 'three/tsl';
import { environmentInfoStruct, constants, lobeWeightsStruct } from './structs.wgsl.js';
import { disneyFresnelFunc, iorToF0Func, schlickFresnelFunc } from './utils.wgsl.js';

/*
wi     : incident vector or light vector (pointing toward the light)
wo     : outgoing vector or view vector (pointing towards the camera)
wh     : computed half vector from wo and wi
Vectors above are assumed to be in tangent space. i.e. +z is along macronormal of the surface
eta    : Greek character used to denote the "ratio of ior"
*/

export const sampleSphereFunc = wgslFn( /* wgsl */ `

	fn sampleSphere( uv: vec2f ) -> vec3f {

		let u = ( uv.x - 0.5 ) * 2.0;
		let t = uv.y * PI * 2.0;
		let f = sqrt( 1.0 - u * u );

		return vec3f( f * cos( t ), f * sin( t ), u );

	}

`, [ constants ] );

// TODO: Investigate sampling directly in tagent space?
// See 16.6.1 in https://www.realtimerendering.com/raytracinggems/unofficial_RayTracingGems_v1.9.pdf
export const diffuseDirectionFunc = wgslFn( /* wgsl */ `

	fn diffuseDirection( wo: vec3f, uv: vec2f ) -> vec3f {

		var lightDirection = sampleSphere( uv );
		lightDirection.z += 1.0;
		lightDirection = normalize( lightDirection );

		return lightDirection;

	}

`, [ sampleSphereFunc ] );

export const getLobeWeightsFunc = wgslFn( /* wgsl */ `

	fn getLobeWeights( wo: vec3f, wi: vec3f, woClearcoat: vec3f, wh: vec3f, clearcoatIor: f32, surf: SurfaceRecord ) -> LobeWeights {

		var weights: LobeWeights;
		var remaining = 1.0;

		let clearcoatF0 = iorToF0( clearcoatIor );
		let clearcoatFresnel = schlickFresnel( saturate( woClearcoat.z ), clearcoatF0 );
		weights.clearcoat = surf.clearcoat * clearcoatFresnel;
		remaining -= weights.clearcoat;

		let fEstimate = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		weights.specular = remaining * ( surf.metalness + ( 1.0 - surf.metalness ) * fEstimate );
		remaining -= weights.specular;

		weights.transmission = remaining * surf.transmission;
		remaining -= weights.transmission;

		weights.diffuse = remaining;

		return weights;

	}

`, [ disneyFresnelFunc, schlickFresnelFunc, iorToF0Func, lobeWeightsStruct, constants ] );

const equirectDirectionToUvFn = wgslFn( /* wgsl */`

	fn equirectDirectionToUv(direction: vec3f) -> vec2f {

		// from Spherical.setFromCartesianCoords
		var uv = vec2f( atan2( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2f( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

` );

const sampleEquirectColorFn = wgslFn( /* wgsl */ `

	fn sampleEquirectColor( envMap: texture_2d<f32>, envMapSampler: sampler, direction: vec3f ) -> vec4f {

		return textureSampleLevel( envMap, envMapSampler, equirectDirectionToUv( direction ), 0 );

	}

`, [ equirectDirectionToUvFn ] );

const sampleHemisphereFn = wgslFn( /* wgsl */ `

	fn sampleHemisphere( n: vec3f, uv: vec2f ) -> vec3f {

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		// https://graphics.pixar.com/library/OrthonormalB/paper.pdf
		let sign = select( sign( n.z ), 1.0, n.z == 0.0 );
		let a = - 1.0 / ( sign + n.z );
		let b = n.x * n.y * a;
		let b1 = vec3( 1.0 + sign * n.x * n.x * a, sign * b, - sign * n.x );
		let b2 = vec3( b, sign + n.y * n.y * a, - n.y );

		let r = sqrt( uv.x );
		let theta = 2.0 * PI * uv.y;
		let x = r * cos( theta );
		let y = r * sin( theta );
		return x * b1 + y * b2 + sqrt( 1.0 - uv.x ) * n;

	}

`, [ constants ] );

export const sampleEnvironmentFn = wgslFn( /* wgsl */ `

	fn sampleEnvironment(
		envMap: texture_2d<f32>,
		envMapSampler: sampler,
		env: EnvironmentInfo,
		direction: vec3f,
		uv: vec2f,
	) -> vec4f {

		let offsetDir = sampleHemisphere( direction, uv ) * 0.5 * env.blur;
		let sampleDir = normalize( env.rotation * direction + offsetDir );
		let col = sampleEquirectColor( envMap, envMapSampler, sampleDir );

		return vec4f( env.intensity * col.rgb, col.a );

	}

`, [ sampleEquirectColorFn, sampleHemisphereFn, environmentInfoStruct ] );

export const luminanceFn = wgslFn( /* wgsl */ `

	fn luminance( color: vec3f ) -> f32 {

		return dot( color, vec3f( 0.2126, 0.7152, 0.0722 ) );

	}

` );

export const weightedAlphaBlendFn = wgslFn( /* wgsl */`

	fn weightedAlphaBlend( prevColor: vec4f, newColor: vec4f, weight: f32 ) -> vec4f {

		let invWeight = 1.0 - weight;
		let totalAlpha = prevColor.a * invWeight + newColor.a * weight;
		var blendedColor = vec4f( 0 );
		if ( totalAlpha != 0.0 ) {

			let prevContrib = prevColor.rgb * invWeight * prevColor.a / totalAlpha;
			let resContrib = newColor.rgb * weight * newColor.a / totalAlpha;
			blendedColor = vec4f( prevContrib + resContrib, totalAlpha );

		}

		return blendedColor;

	}

` );
