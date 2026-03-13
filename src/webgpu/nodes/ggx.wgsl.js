import { wgslFn } from 'three/tsl';
import { constants } from './structs.wgsl.js';

// See sampling.wgsl for vector shorthand explanations
// The GGX functions provide sampling and distribution information for normals as output so
// in order to get probability of scatter direction the half vector must be computed and provided.
// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
// [2] http://jcgt.org/published/0007/04/01/
// [4] http://jcgt.org/published/0003/02/03/
// [5] https://seblagarde.wordpress.com/wp-content/uploads/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf
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

// TODO: write an optimized version, without tan/acos (see [5])
// See equation (34) from reference [0]
export const ggxShadowMaskG1Func = wgslFn( /* wgsl */ `

	fn ggxShadowMaskG1( theta: f32, alpha: f32 ) -> f32 {

		return 1.0 / ( 1.0 + ggxLamda( theta, alpha ) );

	}

`, [ ggxLamdaFunc ] );

// See listing 2 from reference [5]
export const ggxSmithVisibilityFunc = wgslFn( /* wgsl */ `

	fn ggxSmithVisibility( NdotV: f32, NdotL: f32, alpha: f32 ) -> f32 {

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


// TODO: write an aptimized version without tan/acos (see [5])
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
	fn ggxPDF( wo: vec3f, wh: vec3f, roughness: f32 ) -> f32 {

		let D = ggxDistribution( wh.z, roughness );
		let incidentTheta = acos( wo.z );
		let G1 = ggxShadowMaskG1( incidentTheta, roughness );

		return D * G1 * max( 0.0, dot( wo, wh ) ) / wo.z;

	}
`, [ ggxDistributionFunc, ggxShadowMaskG1Func ] );

// ggxPDF, divided by the Jacobian of reflection operation
// See equation (17) from [2]
// Note: dot( wo, halfVector ) cancel out bc its guaranteed to be > 0
export const ggxReflectionAdjustedPDFFunc = wgslFn( /* wgsl */ `
	fn ggxReflectionAdjustedPDF( wo: vec3f, wh: vec3f, alpha: f32 ) -> f32 {

		let NdotV = max( wo.z, 1e-5 );
		let NdotH = max( wh.z, 1e-5 );
		let D = ggxDistribution( NdotH, alpha );
		let incidentTheta = acos( NdotV );
		let G1 = ggxShadowMaskG1( incidentTheta, alpha );

		return D * G1 / ( 4 * wo.z );

	}
`, [ ggxDistributionFunc, ggxShadowMaskG1Func ] );
