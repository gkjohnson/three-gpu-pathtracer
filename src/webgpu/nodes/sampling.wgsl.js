import { wgslFn } from 'three/tsl';
import { surfaceRecordStruct, environmentInfoStruct, constants, lobeWeightsStruct } from './structs.wgsl.js';
import { pcgRand2 } from './random.wgsl.js';
import { saturateCosFunc, squareFunc, squareVecFunc } from './utils.wgsl.js';

/*
wi     : incident vector or light vector (pointing toward the light)
wo     : outgoing vector or view vector (pointing towards the camera)
wh     : computed half vector from wo and wi
Eval   : Get the color and pdf for a direction
Sample : Get the direction, color, and pdf for a sample
eta    : Greek character used to denote the "ratio of ior"
f0     : Amount of light reflected when looking at a surface head on - "fresnel 0"
f90    : Amount of light reflected at grazing angles
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

// https://raytracing.github.io/books/RayTracingInOneWeekend.html#dielectrics/schlickapproximation
export const iorRatioToF0Func = wgslFn( /* wgsl */ `

	fn iorRatioToF0( eta: f32 ) -> f32 {

		return pow( ( 1.0 - eta ) / ( 1.0 + eta ), 2.0 );

	}

` );

export const applyFilteredGlossyFunc = wgslFn( /* wgsl */ `

	fn applyFilteredGlossy( roughness: f32, accumulatedRoughness: f32 ) -> f32 {

		return clamp(
			max(
				roughness,
				accumulatedRoughness * filterGlossyFactor * 5.0 ),
			0.0,
			1.0
		);

	}

` );

// The GGX functions provide sampling and distribution information for normals as output so
// in order to get probability of scatter direction the half vector must be computed and provided.
// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
// [2] http://jcgt.org/published/0007/04/01/
// [4] http://jcgt.org/published/0003/02/03/
export const ggxDirectionFunc = wgslFn( /* wgsl */ `

	fn ggxDirection( incidentDir: vec3f, alpha: vec2f, uv: vec2f ) -> vec3f {

		// The GGX functions provide sampling and distribution information for normals as output so
		// in order to get probability of scatter direction the half vector must be computed and provided.
		// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
		// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
		// [2] http://jcgt.org/published/0007/04/01/
		// [4] http://jcgt.org/published/0003/02/03/

		// trowbridge-reitz === GGX === GTR


		// TODO: try GGXVNDF implementation from reference [2], here. Needs to update ggxDistribution
		// function below, as well

		// Implementation from reference [1]
		// stretch view
		let V = normalize( vec3f( alpha * incidentDir.xy, incidentDir.z ) );

		// orthonormal basis
		var T1: vec3f;
		if ( V.z < 0.9999 ) {
			T1 = normalize( cross( V, vec3( 0.0, 0.0, 1.0 ) ) );
		} else {
			T1 = vec3( 1.0, 0.0, 0.0 );
		}

		let T2 = cross( T1, V );

		// sample point with polar coordinates (r, phi)
		let a = 1.0 / ( 1.0 + V.z );
		let r = sqrt( uv.x );
		var phi: f32;
		if ( uv.y < a ) {
			phi = uv.y / a * PI;
		} else {
			phi = PI + ( uv.y - a ) / ( 1.0 - a ) * PI;
		}
		let P1 = r * cos( phi );
		var P2 = r * sin( phi );
		if ( uv.y >= a ) {
			P2 *= V.z;
		}

		// compute normal
		var N = P1 * T1 + P2 * T2 + V * sqrt( max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) );

		// unstretch
		N = normalize( vec3( alpha * N.xy, max( 0.0, N.z ) ) );

		return N;

	}

`, [ constants ] );

// Below are PDF and related functions for use in a Monte Carlo path tracer
// as specified in Appendix B of the following paper
// See equation (34) from reference [0]
export const ggxLamdaFunc = wgslFn( /* wgsl */ `

	fn ggxLamda( theta: f32, alpha: f32 ) -> f32 {

		let tanTheta = tan( theta );
		let tanTheta2 = tanTheta * tanTheta;
		let alpha2 = alpha * alpha;

		let numerator = - 1.0 + sqrt( 1.0 + alpha2 * tanTheta2 );
		return numerator / 2.0;

	}

` );

// See equation (34) from reference [0]
export const ggxShadowMaskG1Func = wgslFn( /* wgsl */ `

	fn ggxShadowMaskG1( theta: f32, alpha: f32 ) -> f32 {

		return 1.0 / ( 1.0 + ggxLamda( theta, alpha ) );

	}

`, [ ggxLamdaFunc ] );

// See listing 2 from reference below
// https://seblagarde.wordpress.com/wp-content/uploads/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf
export const ggxShadowMaskG2Func = wgslFn( /* wgsl */ `

	fn ggxShadowMaskG2( NdotV: f32, NdotL: f32, alpha: f32 ) -> f32 {

		// Original formulation of G_SmithGGX Correlated
		// lambda_v = ( -1 + sqrt ( alphaG2 * (1 - NdotL2 ) / NdotL2 + 1)) * 0.5 f;
		// lambda_l = ( -1 + sqrt ( alphaG2 * (1 - NdotV2 ) / NdotV2 + 1)) * 0.5 f;
		// G_SmithGGXCorrelated = 1 / (1 + lambda_v + lambda_l );
		// V_SmithGGXCorrelated = G_SmithGGXCorrelated / (4.0 f * NdotL * NdotV );

		// This is an optimized version
		let alpha2 = alpha * alpha;
		// Caution: the "NdotL *" and "NdotV *" are explicitely inversed , this is not a mistake.
		let Lambda_GGXV = NdotL * sqrt (( - NdotV * alpha2 + NdotV ) * NdotV + alpha2 );
		let Lambda_GGXL = NdotV * sqrt (( - NdotL * alpha2 + NdotL ) * NdotL + alpha2 );

		return 0.5 / ( Lambda_GGXV + Lambda_GGXL );

	}

`, [ ggxLamdaFunc ] );


// See equation (33) from reference [0]
export const ggxDistributionFunc = wgslFn( /* wgsl */ `
	fn ggxDistribution( halfVectorAngleCos: f32, alpha: f32 ) -> f32 {

		var a2 = alpha * alpha;
		a2 = max( EPSILON, a2 );
		let cosTheta = halfVectorAngleCos;
		let cosTheta4 = pow( cosTheta, 4.0 );

		if ( cosTheta == 0.0 ) {
			return 0.0;
		}

		let theta = acos( clamp( cosTheta, -1.0, 1.0 ) );
		let tanTheta = tan( theta );
		let tanTheta2 = pow( tanTheta, 2.0 );

		let denom = PI * cosTheta4 * pow( a2 + tanTheta2, 2.0 );
		return ( a2 / denom );

	}
`, );


// See equation (3) from reference [2]
export const ggxPDFFunc = wgslFn( /* wgsl */ `
	fn ggxPDF( wo: vec3f, halfVector: vec3f, roughness: f32 ) -> f32 {

		let incidentTheta = acos( wo.z );
		let D = ggxDistribution( halfVector.z, roughness );
		let G1 = ggxShadowMaskG1( incidentTheta, roughness );

		return D * G1 * max( 0.0, dot( wo, halfVector ) ) / wo.z;

	}
`, [ ggxDistributionFunc, ggxShadowMaskG1Func ] );

// ior is a value between 1.0 and 3.0. 1.0 is air interface
export const iorToFresnel0Func = wgslFn( /* wgsl */ `
	fn iorToFresnel0( transmittedIor: f32, incidentIor: f32 ) -> f32 {

		return square( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ) );

	}

`, [ squareFunc ] );

export const iorToFresnel0VecFunc = wgslFn( /* wgsl */ `

	fn iorToFresnel0Vec( transmittedIor: vec3f, incidentIor: f32 ) -> vec3f {

		return squareVec( ( transmittedIor - vec3f( incidentIor ) ) / ( transmittedIor + vec3f( incidentIor ) ) );

	}

`, [ squareVecFunc ] );

export const fresnel0ToIorFunc = wgslFn( /* wgsl */ `

	fn fresnel0ToIor( fresnel0: vec3f ) -> vec3f {

		let sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );

	}

` );

// Fresnel equations for dielectric/dielectric interfaces. See https://belcour.github.io/blog/research/2017/05/01/brdf-thin-film.html
export const evalSensitivityFunc = wgslFn( /* wgsl */ `
	fn evalSensitivity( OPD: f32, shift: vec3f ) -> vec3f {

		let phase = 2.0 * PI * OPD * 1.0e-9;

		let val = vec3f( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		let pos = vec3f( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		let _var = vec3f( 4.3278e+09, 9.3046e+09, 6.6121e+09 );

		var xyz = val * sqrt( 2.0 * PI * _var ) * cos( pos * phase + shift ) * exp( - square( phase ) * _var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * square( phase ) );
		xyz /= 1.0685e-7;

		let srgb = XYZ_TO_REC709 * xyz;
		return srgb;

	}

`, [ squareFunc, constants ] );

export const schlickFresnelFunc = wgslFn( /* wgsl */ `

	fn schlickFresnel( cosine: f32, f0: f32 ) -> f32 {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

` );

export const schlickFresnelVecFunc = wgslFn( /* wgsl */ `

	fn schlickFresnelVec( cosine: f32, f0: vec3f, f90: vec3f ) -> vec3f {

		return f0 + ( f90 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

` );

// See Section 4. Analytic Spectral Integration, A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence, https://hal.archives-ouvertes.fr/hal-01518344/document
export const evaluateIridescenceFunc = wgslFn( /* wgsl */ `
	fn evalIridescence(
		outsideIOR: f32, eta2: f32, cosTheta1: f32,
		thinFilmThickness: f32, baseF0: vec3f
	) -> vec3f {

		var I: vec3f;

		// Force iridescenceIor -> outsideIOR when thinFilmThickness -> 0.0
		let iridescenceIor = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );

		// Evaluate the cosTheta on the base layer (Snell law)
		let sinTheta2Sq = square( outsideIOR / iridescenceIor ) * ( 1.0 - square( cosTheta1 ) );

		// Handle TIR:
		let cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {

			return vec3f( 1.0 );

		}

		let cosTheta2 = sqrt( cosTheta2Sq );

		// First interface
		let R0 = iorToFresnel0( iridescenceIor, outsideIOR );
		let R12 = schlickFresnel( cosTheta1, R0 );
		let R21 = R12;
		let T121 = 1.0 - R12;
		var phi12 = 0.0;
		if ( iridescenceIor < outsideIOR ) {

			phi12 = PI;

		}

		let phi21 = PI - phi12;

		// Second interface
		let baseIOR = fresnel0ToIor( clamp( baseF0, vec3f( 0.0 ), vec3f( 0.9999 ) ) ); // guard against 1.0
		let R1 = iorToFresnel0Vec( baseIOR, iridescenceIor );
		let R23 = schlickFresnelVec( cosTheta2, R1, vec3f( 1.0 ) );
		var phi23 = vec3f( 0.0 );
		if ( baseIOR[0] < iridescenceIor ) {

			phi23[ 0 ] = PI;

		}

		if ( baseIOR[1] < iridescenceIor ) {

			phi23[ 1 ] = PI;

		}

		if ( baseIOR[2] < iridescenceIor ) {

			phi23[ 2 ] = PI;

		}

		// Phase shift
		let OPD = 2.0 * iridescenceIor * thinFilmThickness * cosTheta2;
		let phi = vec3( phi21 ) + phi23;

		// Compound terms
		let R123 = clamp( R12 * R23, vec3f( 1e-5 ), vec3f( 0.9999 ) );
		let r123 = sqrt( R123 );
		let Rs = square( T121 ) * R23 / ( vec3( 1.0 ) - R123 );

		// Reflectance term for m = 0 (DC term amplitude)
		let C0 = R12 + Rs;
		I = C0;

		// Reflectance term for m > 0 (pairs of diracs)
		var Cm = Rs - T121;
		for ( var m = 1; m <= 2; m += 1 ) {

			Cm *= r123;
			let Sm = 2.0 * evalSensitivity( f32( m ) * OPD, f32( m ) * phi );
			I += Cm * Sm;

		}

		// Since out of gamut colors might be produced, negative color values are clamped to 0.
		return max( I, vec3f( 0.0 ) );

	}

`, [ squareFunc, schlickFresnelFunc, schlickFresnelVecFunc, constants, iorToFresnel0Func, iorToFresnel0VecFunc, fresnel0ToIorFunc, evalSensitivityFunc ] );

export const totalInternalReflectionFunc = wgslFn( /* wgsl */ `

	fn totalInternalReflection( cosTheta: f32, eta: f32 ) -> bool {

		let sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		return eta * sinTheta > 1.0;

	}

` );

export const dielectricFresnelFunc = wgslFn( /* wgsl */ `

	fn dielectricFresnel( cosThetaI: f32, eta: f32 ) -> f32 {

		// https://schuttejoe.github.io/post/disneybsdf/
		let ni = eta;
		let nt = 1.0;

		// Check for total internal reflection
		let sinThetaISq = 1.0f - cosThetaI * cosThetaI;
		let sinThetaTSq = eta * eta * sinThetaISq;
		if( sinThetaTSq >= 1.0 ) {

			return 1.0;

		}

		let sinThetaT = sqrt( sinThetaTSq );

		// LOOKINTO: Why max is needed here?
		let cosThetaT = sqrt( max( 0.0, 1.0f - sinThetaT * sinThetaT ) );
		let rParallel = ( ( nt * cosThetaI ) - ( ni * cosThetaT ) ) / ( ( nt * cosThetaI ) + ( ni * cosThetaT ) );
		let rPerpendicular = ( ( ni * cosThetaI ) - ( nt * cosThetaT ) ) / ( ( ni * cosThetaI ) + ( nt * cosThetaT ) );
		return ( rParallel * rParallel + rPerpendicular * rPerpendicular ) / 2.0;

	}


` );

// LOOKINTO: is totalInternalReflection needed? dielectricFresnel already checks internal reflection
//
// https://schuttejoe.github.io/post/disneybsdf/
export const disneyFresnelFunc = wgslFn( /* wgsl */ `

	fn disneyFresnel( wo: vec3f, wi: vec3f, wh: vec3f, f0: f32, eta: f32, metalness: f32 ) -> f32 {

		let dotHV = dot( wo, wh );
		if ( totalInternalReflection( dotHV, eta ) ) {

			return 1.0;

		}

		let dotHL = dot( wi, wh );
		let dielectricFresnel = dielectricFresnel( abs( dotHV ), eta );
		let metallicFresnel = schlickFresnel( dotHL, f0 );

		return mix( dielectricFresnel, metallicFresnel, metalness );

	}

`, [ totalInternalReflectionFunc, dielectricFresnelFunc, schlickFresnelFunc ] );

export const diffuseEvalFunc = wgslFn( /* wgsl */ `

	fn diffuseEval(
		wo: vec3f, wi: vec3f,
		surf: SurfaceRecord, color: ptr<function, vec3f>,
	) -> f32 {

		// https://schuttejoe.github.io/post/disneybsdf/
		let fl = schlickFresnel( wi.z, 0.0 );
		let fv = schlickFresnel( wo.z, 0.0 );

		let metalFactor = ( 1.0 - surf.metalness );
		let transFactor = ( 1.0 - surf.transmission );
		let rr = 0.5 + 2.0 * surf.roughness * fl * fl;
		let retro = rr * ( fl + fv + fl * fv * ( rr - 1.0f ) );
		let lambert = ( 1.0f - 0.5f * fl ) * ( 1.0f - 0.5f * fv );

		// TODO: subsurface approx?

		// float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		float F = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		*color = ( 1.0 - F ) * transFactor * metalFactor * wi.z * surf.color * ( retro + lambert ) / PI;

		return wi.z / PI;


	}

`, [ schlickFresnelFunc, constants ] );

export const diffuseDirectionFunc = wgslFn( /* wgsl */ `

	fn diffuseDirection( wo: vec3f, surf: SurfaceRecord ) -> vec3f {

		var lightDirection = sampleSphere( pcgRand2() );
		lightDirection.z += 1.0;
		lightDirection = normalize( lightDirection );

		return lightDirection;

	}

`, [ sampleSphereFunc, pcgRand2 ] );

export const evaluateFresnelFunc = wgslFn( /* wgsl */ `

	fn evaluateFresnel( cosTheta: f32, eta: f32, f0: vec3f, f90: vec3f ) -> vec3f {

		if ( totalInternalReflection( cosTheta, eta ) ) {

			return f90;

		}

		return f0 + ( f90 - f0 ) * pow( 1.0 - cosTheta, 5.0 );
	}

`, [ totalInternalReflectionFunc ] );

export const specularEvalFunc = wgslFn( /* wgsl */ `

	fn specularEval(
		wo: vec3f, wi: vec3f, wh: vec3f,
		surf: SurfaceRecord, color: ptr<function, vec3f>
	) -> f32 {

		// if roughness is set to 0 then D === NaN which results in black pixels
		let metalness = surf.metalness;
		let roughness = surf.filteredRoughness;

		let eta = surf.eta;
		let f0 = surf.f0;

		let f0Color = mix( f0 * surf.specularColor * surf.specularIntensity, surf.color, surf.metalness );
		let f90Color = vec3( mix( surf.specularIntensity, 1.0, surf.metalness ) );
		var F = evaluateFresnel( dot( wo, wh ), eta, f0Color, f90Color );

		let iridescenceF = evalIridescence( 1.0, surf.iridescenceIor, dot( wi, wh ), surf.iridescenceThickness, f0Color );
		F = mix( F, iridescenceF,  surf.iridescence );

		// PDF
		// See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
		let incidentTheta = acos( wo.z );
		let G = ggxShadowMaskG2( wo.z, wi.z, roughness );
		let D = ggxDistribution( wh.z, roughness );
		let G1 = ggxShadowMaskG1( incidentTheta, roughness );
		let ggxPdf = D * G1 * max( 0.0, abs( dot( wo, wh ) ) ) / abs ( wo.z );

		*color = wi.z * F * G * D / ( 4.0 * abs( wi.z * wo.z ) );
		return ggxPdf / ( 4.0 * dot( wo, wh ) );

	}

`, [ evaluateFresnelFunc, evaluateIridescenceFunc, ggxShadowMaskG1Func, ggxShadowMaskG2Func, ggxDistributionFunc ] );

export const specularDirectionFunc = wgslFn( /* wgsl */ `

	fn specularDirection( wo: vec3f, surf: SurfaceRecord ) -> vec3f {

		// sample ggx vndf distribution which gives a new normal
		let roughness = surf.roughness * surf.roughness;
		let halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			pcgRand2()
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}

`, [ surfaceRecordStruct, ggxDirectionFunc, pcgRand2 ] );

// TODO: This is just using a basic cosine-weighted specular distribution with an
// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
export const transmissionEvalFunc = wgslFn( /* wgsl */ `

	fn transmissionEval(
		wo: vec3f, wi: vec3f, wh: vec3f,
		surf: SurfaceRecord, color: ptr<function, vec3f>
	) -> f32 {

		*color = surf.transmission * surf.color;

		// PDF
		// float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		// float F = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		// if ( F >= 1.0 ) {

		// 	return 0.0;

		// }

		// return 1.0 / ( 1.0 - F );

		// reverted to previous to transmission. The above was causing black pixels
		let eta = surf.eta;
		let f0 = surf.f0;
		let cosTheta = min( wo.z, 1.0 );
		let sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		let reflectance = schlickFresnel( cosTheta, f0);
		let cannotRefract = eta * sinTheta > 1.0;
		if ( cannotRefract ) {

			return 0.0;

		}

		return 1.0 / ( 1.0 - reflectance );

	}
` );

export const transmissionDirectionFunc = wgslFn( /* wgsl */ `

	fn transmissionDirection( wo: vec3f, surf: SurfaceRecord ) -> vec3f {

		let roughness = surf.filteredRoughness;
		let eta = surf.eta;
		let halfVector = normalize( vec3( 0.0, 0.0, 1.0 ) + sampleSphere( pcgRand2( ) ) * roughness );
		var lightDirection = refract( normalize( - wo ), halfVector, eta );

		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}
		return normalize( lightDirection );

	}
`, [ surfaceRecordStruct, sampleSphereFunc, pcgRand2 ] );

export const clearcoatDirectionFunc = wgslFn( /* wgsl */ `

	fn clearcoatDirection( wo: vec3f, surf: SurfaceRecord ) -> vec3f {

		// sample ggx vndf distribution which gives a new normal
		let roughness = surf.filteredClearcoatRoughness;
		let halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			pcgRand2()
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}

`, [ ggxDirectionFunc, surfaceRecordStruct ] );

export const clearcoatEvalFunc = wgslFn( /* wgsl */ `
	fn clearcoatEval( wo: vec3f, wi: vec3f, wh: vec3f, surf: SurfaceRecord, color: ptr<function, vec3f> ) -> f32 {

		let ior = 1.5;
		let f0 = iorRatioToF0( ior );
		let frontFace = surf.frontFace;
		let roughness = surf.filteredClearcoatRoughness;

		var eta = ior;
		if ( frontFace ) {
			eta = 1.0 / ior;
		}
		let G = ggxShadowMaskG2( wo.z, wi.z, roughness );
		let D = ggxDistribution( wh.z, roughness );
		let F = schlickFresnel( dot( wi, wh ), f0 );

		let fClearcoat = F * D * G / ( 4.0 * abs( wi.z * wo.z ) );
		*color = *color * ( 1.0 - surf.clearcoat * F ) + fClearcoat * surf.clearcoat * wi.z;

		// PDF
		// See equation (27) in http://jcgt.org/published/0003/02/03/
		return ggxPDF( wo, wh, roughness ) / ( 4.0 * dot( wi, wh ) );

	}

`, [ ggxShadowMaskG2Func, ggxShadowMaskG1Func, schlickFresnelFunc, ggxPDFFunc, iorRatioToF0Func ] );

export const getLobeWeightsFunc = wgslFn( /* wgsl */ `

	fn getLobeWeights(wo: vec3f, wi: vec3f, wh: vec3f, clearcoatWo: vec3f, surf: SurfaceRecord) -> LobeWeights {

		// TODO: experiment with this; I don't see any usage of normal?
		let metalness = surf.metalness;
		let transmission = surf.transmission;
		// float fEstimate = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		// Why disney fresnel?
		let fEstimate = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );

		let transSpecularProb = mix( max( 0.25, fEstimate ), 1.0, metalness );
		let diffSpecularProb = 0.5 + 0.5 * metalness;

		var weights: LobeWeights;
		weights.diffuse = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );
		weights.specular = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb;
		weights.transmission = transmission * ( 1.0 - transSpecularProb );
		weights.clearcoat = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );

		let totalWeight = weights.diffuse + weights.specular; // + weights.transmission + weights.clearcoat;
		weights.diffuse /= totalWeight;
		weights.specular /= totalWeight;
		// weights.transmission /= totalWeight;
		// weights.clearcoat /= totalWeight;

		return weights;

	}

`, [ disneyFresnelFunc, schlickFresnelFunc, lobeWeightsStruct ] );

// LOOKINTO: saturate is not needed because of satureateCos on args
export const directionalAlbedoSheenFunc = wgslFn( /* wgsl */ `

	fn directionalAlbedoSheen( cosTheta: f32, alpha: f32 ) -> f32 {

		let c = 1.0 - saturate( cosTheta );
		let c3 = c * c * c;

		return 0.65584461 * c3 + 1.0 / ( 4.16526551 + exp( -7.97291361 * sqrt( alpha ) + 6.33516894 ) );

	}

` );

export const sheenAlbedoScalingFunc = wgslFn( /* wgsl */ `

	fn sheenAlbedoScaling( wo: vec3f, wi: vec3f, surf: SurfaceRecord ) -> f32 {

		let alpha = square( max( surf.sheenRoughness, 0.07 ) );

		let maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

		let eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );
		let eWi = directionalAlbedoSheen( saturateCos( wi.z ), alpha );

		return min( 1.0 - maxSheenColor * eWo, 1.0 - maxSheenColor * eWi );

	}

`, [ squareFunc, saturateCosFunc, directionalAlbedoSheenFunc ] );

// See equation (2) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
export const velvetDFunc = wgslFn( /* wgsl */ `
	fn velvetD( cosThetaH: f32, roughness: f32 ) -> f32 {

		let alpha = square( max( roughness, 0.07 ) );

		let invAlpha = 1.0 / alpha;

		let sqrCosThetaH = cosThetaH * cosThetaH;
		let sinThetaH = max( 1.0 - sqrCosThetaH, 0.001 );

		return ( 2.0 + invAlpha ) * pow( sinThetaH, 0.5 * invAlpha ) / ( 2.0 * PI );

	}

`, [ squareFunc, constants ] );

export const velvetParamsInterpolateFunc = wgslFn( /* wgsl */ `

	fn velvetParamsInterpolate( i: i32, oneMinusAlphaSquared: f32 ) -> f32 {

		const p0 = array<f32, 5>( 25.3245, 3.32435, 0.16801, -1.27393, -4.85967 );
		const p1 = array<f32, 5>( 21.5473, 3.82987, 0.19823, -1.97760, -4.32054 );

		return mix( p1[i], p0[i], oneMinusAlphaSquared );

	}

` );

export const velvetLFunc = wgslFn( /* wgsl */ `
	fn velvetL( x: f32, alpha: f32 ) -> f32 {

		let oneMinusAlpha = 1.0 - alpha;
		let oneMinusAlphaSquared = oneMinusAlpha * oneMinusAlpha;

		let a = velvetParamsInterpolate( 0, oneMinusAlphaSquared );
		let b = velvetParamsInterpolate( 1, oneMinusAlphaSquared );
		let c = velvetParamsInterpolate( 2, oneMinusAlphaSquared );
		let d = velvetParamsInterpolate( 3, oneMinusAlphaSquared );
		let e = velvetParamsInterpolate( 4, oneMinusAlphaSquared );

		return a / ( 1.0 + b * pow( abs( x ), c ) ) + d * x + e;

	}
`, [ velvetParamsInterpolateFunc ] );

// See equation (3) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
export const velvetLambdaFunc = wgslFn( /* wgsl */ `
	fn velvetLambda( cosTheta: f32, alpha: f32 ) -> f32 {
		if ( abs( cosTheta ) < 0.5 ) {
			return exp( velvetL( cosTheta, alpha ) );
		} else {
			return exp( 2.0 * velvetL( 0.5, alpha ) - velvetL( 1.0 - cosTheta, alpha ) );
		}

	}

`, [ velvetLFunc ] );

// See Section 3, Shadowing Term, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
export const velvetGFunc = wgslFn( /* wgsl */ `
	fn velvetG( cosThetaO: f32, cosThetaI: f32, roughness: f32 ) -> f32 {

		let alpha = square( max( roughness, 0.07 ) );

		return 1.0 / ( 1.0 + velvetLambda( cosThetaO, alpha ) + velvetLambda( cosThetaI, alpha ) );

	}

`, [ squareFunc, velvetLambdaFunc ] );

export const sheenColorFunc = wgslFn( /* wgsl */ `

	fn sheenColor( wo: vec3f, wi: vec3f, wh: vec3f, surf: SurfaceRecord ) -> vec3f {

		let cosThetaO = saturateCos( wo.z );
		let cosThetaI = saturateCos( wi.z );
		let cosThetaH = wh.z;

		let D = velvetD( cosThetaH, surf.sheenRoughness );
		let G = velvetG( cosThetaO, cosThetaI, surf.sheenRoughness );

		// See equation (1) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
		var color = surf.sheenColor;
		color *= D * G / ( 4.0 * abs( cosThetaO * cosThetaI ) );
		color *= wi.z;

		return color;

	}

`, [ saturateCosFunc, velvetDFunc, velvetGFunc ] );

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
