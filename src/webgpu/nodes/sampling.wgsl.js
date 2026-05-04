import { wgslFn } from 'three/tsl';
import { environmentInfoStruct, constants, lobeWeightsStruct } from './structs.wgsl.js';
import { evaluateFresnelFunc, iorToF0Func, schlickFresnelFunc } from './utils.wgsl.js';

/*
wi     : incident vector or light vector (pointing toward the light)
wo     : outgoing vector or view vector (pointing towards the camera)
wh     : computed half vector from wo and wi
Vectors above are assumed to be in tangent space. i.e. +z is along macronormal of the surface
eta    : Greek character used to denote the "ratio of ior"
*/

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

export const sampleSphereFunc = wgslFn( /* wgsl */ `

	fn sampleSphere( uv: vec2f ) -> vec3f {

		let u = ( uv.x - 0.5 ) * 2.0;
		let t = uv.y * PI * 2.0;
		let f = sqrt( 1.0 - u * u );

		return vec3f( f * cos( t ), f * sin( t ), u );

	}

`, [ constants ] );

export const diffuseDirectionFunc = wgslFn( /* wgsl */ `

	fn diffuseDirection( wo: vec3f, uv: vec2f ) -> vec3f {

		var lightDirection = sampleSphere( uv );
		lightDirection.z += 1.0;
		lightDirection = normalize( lightDirection );

		return lightDirection;

	}

`, [ sampleSphereFunc ] );

export const getLobeWeightsFunc = wgslFn( /* wgsl */ `

	fn getLobeWeights(wo: vec3f, woClearcoat: vec3f, wh: vec3f, clearcoatIor: f32, surf: SurfaceRecord) -> LobeWeights {

		// TODO: experiment with this; I don't see any usage of normal?
		let metalness = surf.metalness;
		let transmission = surf.transmission;
		let HdotL = dot( wh, wo );
		let fEstimate = evaluateFresnel( HdotL, surf.eta, vec3f( surf.f0 ), vec3f( 1.0 ) ).x;

		let transSpecularProb = mix( max( 0.25, fEstimate ), 1.0, metalness );
		let diffSpecularProb = 0.5 + 0.5 * metalness;

		var weights: LobeWeights;
		weights.diffuse = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );
		weights.specular = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb;

		let clearcoatF0 = iorToF0( clearcoatIor );
		let clearcoatFresnel = schlickFresnel( saturate( woClearcoat.z ), clearcoatF0 );
		weights.clearcoat = surf.clearcoat * clearcoatFresnel;

		weights.transmission = transmission * ( 1.0 - transSpecularProb );

		let totalWeight = weights.diffuse + weights.specular;
		if ( totalWeight > 0 ) {
			weights.diffuse = ( weights.diffuse / totalWeight ) * ( 1 - weights.clearcoat );
			weights.specular = ( weights.specular / totalWeight ) * ( 1 - weights.clearcoat );
		}
		// weights.transmission /= totalWeight;

		return weights;

	}

`, [ schlickFresnelFunc, iorToF0Func, evaluateFresnelFunc, lobeWeightsStruct, constants ] );

const equirectDirectionToUvFn = wgslFn( /* wgsl */`

	fn equirectDirectionToUv( direction: vec3f ) -> vec2f {

		// from Spherical.setFromCartesianCoords
		var uv = vec2f( atan2( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2f( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

` );

export const equirectDirectionPdfFunc = wgslFn( /* wgsl */ `

	fn equirectDirectionPdf( direction: vec3f ) -> f32 {

		let uv = equirectDirectionToUv( direction );
		let theta = uv.y * PI;
		let sinTheta = sin( theta );
		if ( sinTheta == 0.0 ) {

			return 0.0;

		}

		return 1.0 / ( 2.0 * PI * PI * sinTheta );

	}

`, [ equirectDirectionToUvFn ] );

export const equirectUvToDirectionFunc = wgslFn( /* wgsl */ `

	fn equirectUvToDirection( uvIn: vec2f ) -> vec3f {

		// undo above adjustments
		let uv = vec2( uvIn.x - 0.5, 1.0 - uvIn.y );

		// from Vector3.setFromSphericalCoords
		let theta = uv.x * 2.0 * PI;
		let phi = uv.y * PI;

		let sinPhi = sin( phi );

		return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

	}

`, [ constants ] );

export const sampleEquirectColorFn = wgslFn( /* wgsl */ `

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

export const misHeuristicFunc = wgslFn( /* wgsl */ `

	fn misHeuristic( a: f32, b: f32 ) -> f32 {

		let a2 = a * a;
		return a2 / ( a2 + b * b );

	}

` );
