import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { surfaceRecordStruct } from './structs.wgsl.js';

// TODO: LTC sheen (Zeltner et al. 2022, "Practical Multiple-Scattering Sheen Using Linearly
// Transformed Cosines") is likely a better model and is what OpenPBR / Blender Cycles use to
// support sheen BRDF importance sampling & energy conservation.

// "Charlie" velvet, Estevez & Kulla, Imageworks 2017
// http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf

// See equation (2)
const velvetDFunc = wgslTagFn/* wgsl */`

	fn velvetD( cosThetaH: f32, roughness: f32 ) -> f32 {

		var alpha = max( roughness, 0.07 );
		alpha = alpha * alpha;

		let invAlpha = 1.0 / alpha;
		let sqrCosThetaH = cosThetaH * cosThetaH;
		let sinThetaH = max( 1.0 - sqrCosThetaH, 0.001 );

		return ( 2.0 + invAlpha ) * pow( sinThetaH, 0.5 * invAlpha ) / ( 2.0 * PI );

	}

`;

const velvetParamsInterpolateFunc = wgslTagFn/* wgsl */`

	fn velvetParamsInterpolate( i: i32, oneMinusAlphaSquared: f32 ) -> f32 {

		let p0 = array<f32, 5>( 25.3245, 3.32435, 0.16801, - 1.27393, - 4.85967 );
		let p1 = array<f32, 5>( 21.5473, 3.82987, 0.19823, - 1.97760, - 4.32054 );

		return mix( p1[ i ], p0[ i ], oneMinusAlphaSquared );

	}

`;

const velvetLFunc = wgslTagFn/* wgsl */`

	fn velvetL( x: f32, alpha: f32 ) -> f32 {

		let oneMinusAlpha = 1.0 - alpha;
		let oneMinusAlphaSquared = oneMinusAlpha * oneMinusAlpha;

		let a = ${ velvetParamsInterpolateFunc }( 0, oneMinusAlphaSquared );
		let b = ${ velvetParamsInterpolateFunc }( 1, oneMinusAlphaSquared );
		let c = ${ velvetParamsInterpolateFunc }( 2, oneMinusAlphaSquared );
		let d = ${ velvetParamsInterpolateFunc }( 3, oneMinusAlphaSquared );
		let e = ${ velvetParamsInterpolateFunc }( 4, oneMinusAlphaSquared );

		return a / ( 1.0 + b * pow( abs( x ), c ) ) + d * x + e;

	}

`;

// See equation (3)
const velvetLambdaFunc = wgslTagFn/* wgsl */`

	fn velvetLambda( cosTheta: f32, alpha: f32 ) -> f32 {

		if ( abs( cosTheta ) < 0.5 ) {

			return exp( ${ velvetLFunc }( cosTheta, alpha ) );

		} else {

			return exp( 2.0 * ${ velvetLFunc }( 0.5, alpha ) - ${ velvetLFunc }( 1.0 - cosTheta, alpha ) );

		}

	}

`;

// See Section 3, Shadowing Term
const velvetGFunc = wgslTagFn/* wgsl */`

	fn velvetG( cosThetaO: f32, cosThetaI: f32, roughness: f32 ) -> f32 {

		var alpha = max( roughness, 0.07 );
		alpha = alpha * alpha;

		return 1.0 / ( 1.0 + ${ velvetLambdaFunc }( cosThetaO, alpha ) + ${ velvetLambdaFunc }( cosThetaI, alpha ) );

	}

`;

// analytic directional albedo fit, used for energy compensation when layering ( Section 5 )
const directionalAlbedoSheenFunc = wgslTagFn/* wgsl */`

	fn directionalAlbedoSheen( cosThetaIn: f32, alpha: f32 ) -> f32 {

		let cosTheta = saturate( cosThetaIn );
		let c = 1.0 - cosTheta;
		let c3 = c * c * c;

		return 0.65584461 * c3 + 1.0 / ( 4.16526551 + exp( -7.97291361 * sqrt( alpha ) + 6.33516894 ) );

	}

`;

// See Section 5, Layering - the factor the base lobes are attenuated by so the sheen layer
// does not add energy on top of a fully reflective base
export const sheenAlbedoScalingFunc = wgslTagFn/* wgsl */`

	fn sheenAlbedoScaling( wo: vec3f, wi: vec3f, surf: ${ surfaceRecordStruct } ) -> f32 {

		var alpha = max( surf.sheenRoughness, 0.07 );
		alpha = alpha * alpha;

		let maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

		let eWo = ${ directionalAlbedoSheenFunc }( clamp( wo.z, 0.001, 1.0 ), alpha );
		let eWi = ${ directionalAlbedoSheenFunc }( clamp( wi.z, 0.001, 1.0 ), alpha );

		return min( 1.0 - maxSheenColor * eWo, 1.0 - maxSheenColor * eWi );

	}

`;

export const sheenColorFunc = wgslTagFn/* wgsl */`

	fn sheenColor( wo: vec3f, wi: vec3f, wh: vec3f, surf: ${ surfaceRecordStruct } ) -> vec3f {

		let cosThetaO = clamp( wo.z, 0.001, 1.0 );
		let cosThetaI = clamp( wi.z, 0.001, 1.0 );
		let cosThetaH = wh.z;

		let D = ${ velvetDFunc }( cosThetaH, surf.sheenRoughness );
		let G = ${ velvetGFunc }( cosThetaO, cosThetaI, surf.sheenRoughness );

		// See equation (1) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
		var color = surf.sheenColor;
		color *= D * G / ( 4.0 * abs( cosThetaO * cosThetaI ) );

		return color;

	}

`;
