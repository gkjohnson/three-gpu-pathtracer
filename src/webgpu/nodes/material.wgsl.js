import { mat3, wgsl, wgslFn } from 'three/tsl';
import {
	inverseMat3x3Func,
	getBasisFromNormalFunc,
	iorToF0Func,
	schlickFresnelFunc,
	schlickFresnelVecFunc,
	sampleTexelFunc,
	iorToF0GeneralFunc,
	fresnel0ToIorFunc,
	iorToF0GeneralVecFunc,
	pow2,
} from './utils.wgsl.js';
import {
	ggxSmithVisibilityFunc,
	ggxDistributionFunc,
	ggxDirectionFunc,
	ggxReflectionAdjustedPDFFunc,
} from './ggx.wgsl.js';
import { constants, surfaceRecordStruct, scatterRecordStruct } from './structs.wgsl.js';
import { sampleSphereCosineFn } from './sampling.wgsl.js';
import { pcgInit, pcgRand2 } from './random.wgsl.js';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';

export const getSurfaceRecordFunc = wgslFn( /* wgsl */ `

	fn getSurfaceRecord(
		material: Material,
		vertexData: bvh_GeometryStruct,
		side: bool,
		faceNormal: vec3f,
		blurRoughness: f32,
		textures: texture_2d_array<f32>,
		textureSampler: sampler,
	) -> SurfaceRecord {
		let uv = vertexData.uv.xy;

		var normal = faceNormal * select( -1.0, 1.0, side );
		if ( material.flatShading == 0 ) {

			normal = vertexData.normal.xyz;

		}
		normal = normalize( normal );
		let baseNormal = normal;

		if ( material.normalMap != -1 ) {

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( vertexData.tangent ) > 0.0 ) {

				let tangent = normalize( vertexData.tangent.xyz );
				let bitangent = normalize( cross( baseNormal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, baseNormal );

				let uvPrime = material.normalMapTransform * vec3( uv, 1.0 );
				var texNormal = sampleTexel( textures, textureSampler, uvPrime.xy, material.normalMap, 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.normalScale, 1.0 );
				normal = normalize( vTBN * texNormal );

			}

		}

		normal *= select( -1.0, 1.0, side );

		var albedo = vec4( material.color, material.opacity );

		if ( material.vertexColors == 1 ) {

			let vertexColor = vertexData.color.xyz;
			albedo *= vec4f( vertexColor, 1.0 );

		}

		if ( material.map != -1 ) {

			let uvPrime = material.mapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.map, 0 );
			albedo *= vec4f( texColor.rgb, 1.0 );

		}

		var roughness = material.roughness;
		if ( material.roughnessMap != -1 ) {

			let uvPrime = material.roughnessMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.roughnessMap, 0 );
			roughness *= texColor.g;

		}

		var metalness = material.metalness;
		if ( material.metalnessMap != -1 ) {

			let uvPrime = material.metalnessMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.metalnessMap, 0 );
			metalness *= texColor.b;

		}

		var emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.emissiveMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.emissiveMap, 0 );
			emission *= texColor.rgb;

		}

		var transmission = material.transmission;
		if ( material.transmissionMap != -1 ) {

			let uvPrime = material.transmissionMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.transmissionMap, 0 );
			transmission *= texColor.r;

		}

		var clearcoat = material.clearcoat;
		if ( material.clearcoatMap != -1 ) {

			let uvPrime = material.clearcoatMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.clearcoatMap, 0 );
			clearcoat *= texColor.r;

		}

		var clearcoatRoughness = material.clearcoatRoughness;
		if ( material.clearcoatRoughnessMap != -1 ) {

			let uvPrime = material.clearcoatRoughnessMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.clearcoatRoughnessMap, 0 );
			clearcoatRoughness *= texColor.g;

		}

		var clearcoatNormal = baseNormal;
		if ( material.clearcoatNormalMap != -1 ) {

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( vertexData.tangent ) > 0.0 ) {

				let tangent = normalize( vertexData.tangent.xyz );
				let bitangent = normalize( cross( baseNormal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, baseNormal );

				let uvPrime = material.clearcoatNormalMapTransform * vec3( uv, 1.0 );
				var texNormal = sampleTexel( textures, textureSampler, uvPrime.xy, material.clearcoatNormalMap, 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.clearcoatNormalScale, 1.0 );
				clearcoatNormal = normalize( vTBN * texNormal );

			}

		}
		clearcoatNormal *= select( -1.0, 1.0, side );

		var sheenColor = material.sheenColor;
		if ( material.sheenColorMap != -1 ) {

			let uvPrime = material.sheenColorMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.sheenColorMap, 0 );
			sheenColor *= texColor.rgb;

		}

		var sheenRoughness = material.sheenRoughness;
		if ( material.sheenRoughnessMap != -1 ) {

			let uvPrime = material.sheenRoughnessMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.sheenRoughnessMap, 0 );
			sheenRoughness *= texColor.r;

		}

		var iridescence = material.iridescence;
		if ( material.iridescenceMap != -1 ) {

			let uvPrime = material.iridescenceMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.iridescenceMap, 0 );
			iridescence *= texColor.r;

		}

		var iridescenceThickness = material.iridescenceThicknessMaximum;
		if ( material.iridescenceThicknessMap != -1 ) {

			let uvPrime = material.iridescenceThicknessMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.iridescenceThicknessMap, 0 );

			iridescenceThickness = mix(
				material.iridescenceThicknessMinimum,
				material.iridescenceThicknessMaximum,
				texColor.g,
			);

		}

		var specularColor = material.specularColor;
		if ( material.specularColorMap != -1 ) {

			let uvPrime = material.specularColorMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.specularColorMap, 0 );
			specularColor *= texColor.rgb;

		}

		var specularIntensity = material.specularIntensity;
		if ( material.specularIntensityMap != -1 ) {

			let uvPrime = material.specularIntensityMapTransform * vec3f( uv, 1 );
			let texColor = sampleTexel( textures, textureSampler, uvPrime.xy, material.specularIntensityMap, 0 );
			specularIntensity *= texColor.r;

		}

		var surf: SurfaceRecord;

		surf.volumeParticle = false;
		surf.faceNormal = faceNormal;
		surf.normal = normal;

		surf.metalness = metalness;
		surf.color = albedo.rgb;
		surf.emission = emission;

		surf.ior = material.ior;
		surf.transmission = transmission;
		surf.thinFilm = material.thinFilm == 1;
		surf.attenuationColor = material.attenuationColor;
		surf.attenuationDistance = material.attenuationDistance;

		surf.clearcoatNormal = clearcoatNormal;
		surf.clearcoat = clearcoat;

		surf.iridescence = iridescence;
		surf.iridescenceIor = material.iridescenceIor;
		surf.iridescenceThickness = iridescenceThickness;

		surf.specularColor = specularColor;
		surf.specularIntensity = specularIntensity;

		let minRoughness = max( MIN_ROUGHNESS, blurRoughness );
		surf.roughness = clamp( roughness, minRoughness, 1.0 );
		surf.clearcoatRoughness = clamp( clearcoatRoughness, minRoughness, 1.0 );
		surf.sheenRoughness = clamp( sheenRoughness, minRoughness, 1.0 );

		// frontFace is used to determine transmissive properties and PDF. If no transmission is used
		// then we can just always assume this is a front face.
		let frontFace = side || transmission == 0.0;
		if ( frontFace ) {
			surf.eta = 1.0 / material.ior;
		} else {
			surf.eta = material.ior;
		}
		surf.f0 = iorToF0( surf.eta );

		// get the normal frames
		surf.normalBasis = getBasisFromNormal( surf.normal );
		surf.normalInvBasis = inverse( surf.normalBasis );

		surf.clearcoatBasis = getBasisFromNormal( surf.clearcoatNormal );
		surf.clearcoatInvBasis = inverse( surf.clearcoatBasis );

		return surf;
	}

`, [
	inverseMat3x3Func,
	iorToF0Func,
	getBasisFromNormalFunc,
	sampleTexelFunc,
	surfaceRecordStruct,
	constants,
] );

export const lambertBsdfFunc = wgslFn( /* wgsl */`

	fn bsdfSample( worldWo: vec3f, surf: SurfaceRecord ) -> ScatterRecord {

		var record: ScatterRecord;

		// Return bsdfValue / pdf, not bsdfValue and pdf separatly?
		let res = sampleSphereCosine( pcgRand2(), surf.normal );
		record.direction = res.xyz;
		record.pdf = res.w;
		record.color = surf.color * dot( record.direction, surf.normal ) / PI;

		return record;

	}

`, [ scatterRecordStruct, sampleSphereCosineFn, pcgRand2, constants, surfaceRecordStruct ] );

/*
 *
 * N 			  : Macronormal of the surface
 * V ( wo ) : View direction
 * L ( wi ) : Light direction
 * H ( wh ) : Halfvector between V and L, micronormal of the surface in ggx
 * f0       : Amount of light reflected when looking at a surface head on - "fresnel 0"
 * f90      : Amount of light reflected at grazing angles
 *
 */

// Disney Diffuse BRDF without subsurface approximation
export const diffuseBrdfFunc = wgslFn( /* wgsl */ `

	fn diffuseBrdf( NdotV: f32, HdotV: f32, NdotL: f32, HdotL: f32, surf: SurfaceRecord ) -> vec3f {

		// Heaviside function effectively
		if ( HdotV < 0.0 || HdotL < 0.0 ) {

			return vec3f( 0.0 );

		}

		// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
		// See equation (4)

		let fl = schlickFresnel( abs( NdotL ), 0.0 );
		let fv = schlickFresnel( abs( NdotV ), 0.0 );

		let alpha = surf.roughness * surf.roughness;
		let bias = mix( 0.0, 0.5, alpha) - 1;
		let energyFactor = mix( 1.0, 1.0 / 1.51, alpha );

		let rr = 2.0 * alpha * HdotV * HdotV;
		let retro = rr * ( fl + fv + fl * fv * ( rr + 2.0 * bias ) );
		let fresnel = ( 1.0 + bias * fl ) * ( 1.0f + bias * fv );

		// TODO: subsurface approx?

		return energyFactor * ( surf.color / PI ) * ( retro + fresnel );

	}

`, [ constants, schlickFresnelFunc, surfaceRecordStruct ] );

export const specularBtdfFunc = wgslFn( /* wgsl */`

	fn specularBtdf(
		NdotL: f32, HdotL: f32, NdotV: f32, HdotV: f32, NdotH: f32,
		alpha: f32, eta: f32, ior: f32,
	) -> vec3f {

		// Heaviside function for G term
		if ( NdotV * HdotV < 0.0 || NdotL * HdotL < 0.0 || HdotV * HdotL > 0.0 ) {

			return vec3f( 0.0 );

		}

		// let reflectionVis = ggxSmithVisibility( abs( NdotV ), abs( NdotL ), alpha );
		// let Vis = 4.0 * reflectionVis * abs( HdotV ) * abs( HdotL ) / pow2( eta * HdotV + HdotL );

		let G1_i = ggxShadowMaskG1( NdotV, alpha );
		let G1_o = ggxShadowMaskG1( NdotL, alpha );
		// separable G2 product, no height correlation
		let Vis = G1_i * G1_o * abs(HdotV) * abs(HdotL) /
							( abs(NdotV) * abs(NdotL) * pow2(eta * HdotV + HdotL) );

		let f0 = iorToF0( ior );
		let F = schlickFresnel( HdotV, f0 );

		let D = ggxDistribution( NdotH, alpha );

		return vec3f( ( 1 - F ) * D * Vis );

	}

`, [ ggxSmithVisibilityFunc, ggxDistributionFunc, pow2 ] );

export const specularBrdfFunc = wgslFn( /* wgsl */ `

	fn specularBrdf( NdotL: f32, HdotL: f32, NdotV: f32, HdotV: f32, NdotH: f32, alpha: f32 ) -> vec3f {

		// Heaviside function for G term
		if ( HdotV < 0.0 || HdotL < 0.0 ) {

			return vec3f( 0.0 );

		}

		let Vis = ggxSmithVisibility( abs( NdotV ), abs( NdotL ), alpha );
		let D = ggxDistribution( NdotH, alpha );

		return vec3f( D * Vis );

	}

`, [ ggxSmithVisibilityFunc, ggxDistributionFunc ] );

export const fresnelMixFunc = wgslFn( /* wgsl */ `

	fn fresnelMix( HdotV: f32, ior: f32, base: vec3f, layer: vec3f ) -> vec3f {

		let f0 = iorToF0( ior );
  	let F = schlickFresnel( HdotV, f0 );

  	return base + F * layer;

	}

`, [ schlickFresnelFunc, iorToF0Func ] );

const iridConst = wgsl( /* wgsl */ `

const XYZ_TO_REC709 = mat3x3(
	3.2404542, - 0.9692660, 0.0556434,
	- 1.5371385, 1.8760108, - 0.2040259,
	- 0.4985314, 0.0415560, 1.0572252
);


` );

const evalSensitivityFunc = wgslTagFn`

	fn evalSensitivity( OPD: f32, shift: vec3f ) -> vec3f {
		${ [ iridConst ] }

		let phase = 2.0 * ${ Math.PI } * OPD * 1.0e-9;
    const val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
    const pos = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
    const _var = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);

    var xyz = val * sqrt(2.0 * ${ Math.PI } * _var) * cos(pos * phase + shift) * exp(-phase * phase * _var);
    xyz.x += 9.7470e-14 * sqrt(2.0 * ${ Math.PI } * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
    xyz /= 1.0685e-7;

    let rgb = XYZ_TO_REC709 * xyz;
    return rgb;

	}

`;

// Reference: Belcour/Barla, 2017
// https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html
// This is a simplified model that ignores light polarization and uses fresnel approximation
export const iridescentFresnelFunc = wgslFn( /* wgsl */ `

	fn iridescentFresnel(
		cosTheta1: f32, baseF0: vec3f, iridescenceIor: f32,
		outsideIor: f32, iridescenceThickness: f32,
	) -> vec3f {

		let sinTheta2Sq = pow( outsideIor / iridescenceIor, 2.0 ) * ( 1.0 - pow( cosTheta1, 2.0 ) );
		let cosTheta2Sq = 1.0 - sinTheta2Sq;

		// Handle total internal reflection
		if ( cosTheta2Sq < 0.0 ) {

			return vec3( 1.0 );

		}

		let cosTheta2 = sqrt( cosTheta2Sq );

		// First interface: air -> iridescent thin film
		let R0 = iorToF0General( iridescenceIor, outsideIor );
		let R12 = schlickFresnel( cosTheta1, R0 );
		let R21 = R12;
		let T121 = 1.0 - R12;
		let phi12 = select( 0.0, PI, iridescenceIor < outsideIor );
		let phi21 = PI - phi12;

		// Second interface: iridescent thin film -> base material
		let baseIor = fresnel0ToIor( baseF0 + 0.0001 ); // guard against 1.0
		let R1 = iorToF0GeneralVec( baseIor, vec3( iridescenceIor ) );
		let R23 = schlickFresnelVec( cosTheta2, R1, vec3( 1.0 ) );
		let phi23 = select( vec3( 0.0 ), vec3( PI ), baseIor < vec3( iridescenceIor ) );

		// Phase shift
		let OPD = 2.0 * iridescenceIor * iridescenceThickness * cosTheta2;
		let phi = vec3( phi21 ) + phi23;

		// Analytical integration
		// Compound terms
		let R123 = clamp( R12 * R23, vec3( 1e-5 ), vec3( 0.9999 ) );
		let r123 = sqrt( R123 );
		let Rs = T121 * T121 * R23 / ( vec3( 1.0 ) - R123 );

		// Reflectance term for m = 0 (DC term amplitude)
		let C0 = R12 + Rs;
		var I = C0;

		// Reflectance term for m > 0 (pairs of diracs)
		var Cm = Rs - T121;
		for (var m = 1; m <= 2; m += 1) {

			Cm *= r123;
			let Sm = 2.0 * evalSensitivity( f32( m ) * OPD, f32( m ) * phi );
			I += Cm * Sm;

		}

		return max( I, vec3(0.0) );

	}

`, [ iorToF0GeneralFunc, iorToF0GeneralVecFunc, schlickFresnelFunc, fresnel0ToIorFunc, evalSensitivityFunc ] );

const rgbMixFunc = wgslFn( /* wgsl */ `

	fn rgbMix( base: vec3f, specular: vec3f, rgbAlpha: vec3f ) -> vec3f {

		let alphaMax = max( max( rgbAlpha.x, rgbAlpha.y ), rgbAlpha.z );
		return ( 1 - alphaMax ) * base + rgbAlpha * specular;

	}

` );

export const iridescentDielectricLayerFunc = wgslFn( /* wgsl */ `

	fn iridescentDielectricLayer(
		dielectricBase: vec3f, base: vec3f, specular: vec3f, HdotL: f32,
		outsideIor: f32, baseIor: f32, iridescenceIor: f32, thickness: f32, strength: f32,
	) -> vec3f {

		let baseF0 = vec3( iorToF0( baseIor ) );

		let iridescentF = iridescentFresnel( HdotL, baseF0, iridescenceIor, outsideIor, thickness );

		return mix( dielectricBase, rgbMix( base, specular, iridescentF ), strength );

	}

`, [ iorToF0Func, iridescentFresnelFunc, rgbMixFunc ] );

export const iridescentConductorLayerFunc = wgslFn( /* wgsl */ `

	fn iridescentConductorLayer(
		metalBase: vec3f, specular: vec3f, baseF0: vec3f, HdotL: f32,
		outsideIor: f32, iridescenceIor: f32, thickness: f32, strength: f32,
	) -> vec3f {

		let iridescenceF = iridescentFresnel( HdotL, baseF0, iridescenceIor, outsideIor, thickness );

		return mix( metalBase, specular * iridescenceF, strength );

	}

`, [ iridescentFresnelFunc ] );

export const conductorFresnelFunc = ( turquinTexture ) => wgslFn( /* wgsl */ `

	fn conductorFresnel( NdotV: f32, VdotH: f32, f0: vec3f, bsdf: vec3f, alpha: f32 ) -> vec3f {

	  let ss = bsdf * schlickFresnelVec( abs( VdotH ), f0, vec3f( 1 ) );

		let uv = vec2( NdotV, sqrt( alpha ) );
		let energySs = max( textureSampleLevel( turquinTexture, turquinTexture_sampler, uv, 0 ).r, 1e-5 );

		return ss * ( 1.0 + f0 * ( 1.0 - energySs ) / energySs );

	}

`, [ schlickFresnelVecFunc, turquinTexture ] );

export const fresnelCoatFunc = wgslFn( /* wgsl */ `

	fn fresnelCoat( NdotVc: f32, ior: f32, base: vec3f, layer: vec3f, weight: f32 ) -> vec3f {

		let f0 = iorToF0( ior );
		let F = schlickFresnel( NdotVc, f0 );

		return mix( base, layer, weight * F );

	}

`, [ iorToF0Func, schlickFresnelFunc ] );

// GGX Multibounce compensation using Turquin's method

export const albedoIntegralMetallic = wgslFn( /* wgsl */ `

	fn albedo(
		texture: texture_storage_2d<r16float, write>,

		globalId: vec3u,
	) -> void {

		const INTEGRATION_SAMPLES = ( 1 << 20 );
		pcgInitialize( globalId.xy, 0 );

		let dimensions = textureDimensions( texture ).xy;
		let uv = ( vec2f( globalId.xy ) + vec2f( 0.5 ) ) / vec2f( dimensions );

		let cosThetaO = uv.x;
		let roughness = uv.y;

		let alpha = roughness * roughness;

		let wo = vec3( sqrt( 1 - cosThetaO * cosThetaO ), 0 , cosThetaO );

		var result = 0.0;
		for ( var i = 0; i < INTEGRATION_SAMPLES; i++ ) {

			let wh = ggxDirection( wo, vec2( alpha ), pcgRand2() );
			var wi = - reflect( wo, wh );

			let NdotV = max( wo.z, EPSILON );
			let NdotL = saturate( wi.z );
			let NdotH = saturate( wh.z );
			let HdotV = saturate( dot( wo, wh ) );
			let HdotL = saturate( dot( wi, wh ) );

			let specular = specularBrdf( NdotL, HdotL NdotV, HdotV, NdotH, alpha );
			let pdf = ggxReflectionAdjustedPDF( NdotV, NdotH, alpha );

			var weight = 0.0;
			if ( pdf != 0.0 ) {
				weight = 1 / pdf;
			}

			result += specular.x * NdotL * weight;

		}

		result /= f32( INTEGRATION_SAMPLES );

		textureStore( texture, globalId.xy, vec4( result ) );

	}

`, [ pcgInit, pcgRand2, constants, specularBrdfFunc, ggxDirectionFunc, ggxReflectionAdjustedPDFFunc ] );


// https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md#attenuation
export const transmissionAttenuationFunc = wgslFn( /* wgsl */ `

	fn transmissionAttenuation( dist: f32, attColor: vec3f, attDist: f32 ) -> vec3f {

		return pow( attColor, vec3f( dist / attDist ) );

	}

` );
