import { wgslFn } from 'three/tsl';
import {
	inverseMat3x3Func,
	getBasisFromNormalFunc,
	iorToF0Func,
	schlickFresnelFunc,
	schlickFresnelVecFunc,
} from './utils.wgsl';
import {
	ggxSmithVisibilityFunc,
	ggxDistributionFunc,
	ggxDirectionFunc,
	ggxReflectionAdjustedPDFFunc,
} from './ggx.wgsl';
import { constants, surfaceRecordStruct, scatterRecordStruct } from './structs.wgsl';
import { sampleSphereCosineFn } from './sampling.wgsl';
import { pcgInit, pcgRand2 } from './random.wgsl';

export const getSurfaceRecordFunc = wgslFn( /* wgsl */ `

	fn getSurfaceRecord(
		material: Material,
		vertexData: bvh_GeometryStruct,
		side: f32,
		faceNormal: vec3f,
		textures: texture_2d_array<f32>,
		textureSampler: sampler,
	) -> SurfaceRecord {
		let uv = vertexData.uv.xy;

		var normal = faceNormal * side;
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
				let bitangent = normalize( cross( faceNormal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, faceNormal );

				let uvPrime = material.normalMapTransform * vec3( uv, 1.0 );
				var texNormal = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.normalMap ), 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.normalScale, 1.0 );
				normal = normalize( vTBN * texNormal );

			}

		}

		normal *= side;

		var albedo = vec4( material.color, material.opacity );

		if ( material.vertexColors == 1 ) {

			let vertexColor = vertexData.color.xyz;
			albedo *= vec4f( vertexColor, 1.0 );

		}

		if ( material.map != -1 ) {

			let uvPrime = material.mapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.map ), 0 );
			albedo *= vec4f( texColor.rgb, 1.0 );

		}

		var roughness = material.roughness;
		if ( material.roughnessMap != -1 ) {

			let uvPrime = material.roughnessMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.roughnessMap ), 0 );
			roughness *= texColor.g;

		}

		var metalness = material.metalness;
		if ( material.metalnessMap != -1 ) {

			let uvPrime = material.metalnessMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.metalnessMap ), 0 );
			metalness *= texColor.b;

		}

		var emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.emissiveMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.emissiveMap ), 0 );
			emission *= texColor.rgb;

		}

		var transmission = material.transmission;
		if ( material.transmissionMap != -1 ) {

			let uvPrime = material.transmissionMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.transmissionMap ), 0 );
			transmission *= texColor.r;

		}

		var clearcoat = material.clearcoat;
		if ( material.clearcoatMap != -1 ) {

			let uvPrime = material.clearcoatMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.clearcoatMap ), 0 );
			clearcoat *= texColor.r;

		}

		var clearcoatRoughness = material.clearcoatRoughness;
		if ( material.clearcoatRoughnessMap != -1 ) {

			let uvPrime = material.clearcoatRoughnessMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.clearcoatRoughnessMap ), 0 );
			clearcoatRoughness *= texColor.r;

		}

		var clearcoatNormal = baseNormal;
		if ( material.clearcoatNormalMap != -1 ) {

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( vertexData.tangent ) > 0.0 ) {

				let tangent = normalize( vertexData.tangent.xyz );
				let bitangent = normalize( cross( faceNormal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, faceNormal );

				let uvPrime = material.clearcoatNormalMapTransform * vec3( uv, 1.0 );
				var texNormal = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.clearcoatNormalMap ), 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.clearcoatNormalScale, 1.0 );
				clearcoatNormal = normalize( vTBN * texNormal );

			}

		}
		clearcoatNormal *= side;

		var sheenColor = material.sheenColor;
		if ( material.sheenColorMap != -1 ) {

			let uvPrime = material.sheenColorMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.sheenColorMap ), 0 );
			sheenColor *= texColor.rgb;

		}

		var sheenRoughness = material.sheenRoughness;
		if ( material.sheenRoughnessMap != -1 ) {

			let uvPrime = material.sheenRoughnessMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.sheenRoughnessMap ), 0 );
			sheenRoughness *= texColor.r;

		}

		var iridescence = material.iridescence;
		if ( material.iridescenceMap != -1 ) {

			let uvPrime = material.iridescenceMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.iridescenceMap ), 0 );
			iridescence *= texColor.r;

		}

		var iridescenceThickness = material.iridescenceThicknessMaximum;
		if ( material.iridescenceThicknessMap != -1 ) {

			let uvPrime = material.iridescenceThicknessMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.iridescenceThicknessMap ), 0 );

			iridescenceThickness = mix(
				material.iridescenceThicknessMinimum,
				material.iridescenceThicknessMaximum,
				texColor.g,
			);

		}

		var specularColor = material.specularColor;
		if ( material.specularColorMap != -1 ) {

			let uvPrime = material.specularColorMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.specularColorMap ), 0 );
			specularColor *= texColor.rgb;

		}

		var specularIntensity = material.specularIntensity;
		if ( material.specularIntensityMap != -1 ) {

			let uvPrime = material.specularIntensityMapTransform * vec3f( uv, 1 );
			let texColor = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.specularIntensityMap ), 0 );
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

		surf.roughness = roughness;
		surf.clearcoatRoughness = clearcoatRoughness;
		surf.sheenRoughness = sheenRoughness;

		// frontFace is used to determine transmissive properties and PDF. If no transmission is used
		// then we can just always assume this is a front face.
		surf.frontFace = side == 1.0 || transmission == 0.0;
		if ( material.thinFilm == 1 || surf.frontFace ) {
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
	surfaceRecordStruct,
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

	fn diffuseBrdf( NdotV: f32, NdotL: f32, VdotH: f32, surf: SurfaceRecord ) -> vec3f {

		// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
		// See equation (4)

		let fl = schlickFresnel( NdotL, 0.0 );
		let fv = schlickFresnel( NdotV, 0.0 );

		let alpha = surf.roughness * surf.roughness;
		let bias = mix( 0.0, 0.5, alpha) - 1;
		let energyFactor = mix( 1.0, 1.0 / 1.51, alpha );

		let rr = 2.0 * alpha * VdotH * VdotH;
		let retro = rr * ( fl + fv + fl * fv * ( rr + 2.0 * bias ) );
		let fresnel = ( 1.0 + bias * fl ) * ( 1.0f + bias * fv );

		// TODO: subsurface approx?

		return energyFactor * ( surf.color / PI ) * ( retro + fresnel );

	}

`, [ constants, schlickFresnelFunc, surfaceRecordStruct ] );

export const specularBrdfFunc = wgslFn( /* wgsl */ `

	fn specularBrdf( NdotL: f32, NdotV: f32, NdotH: f32, alpha: f32 ) -> vec3f {

		let Vis = ggxSmithVisibility( NdotV, NdotL, alpha );
		let D = ggxDistribution( NdotH, alpha );

		return vec3f( D * Vis );

	}

`, [ ggxSmithVisibilityFunc, ggxDistributionFunc ] );

export const fresnelMixFunc = wgslFn( /* wgsl */ `

	fn fresnelMix( VdotH: f32, ior: f32, base: vec3f, layer: vec3f ) -> vec3f {

		let f0 = iorToF0( ior );
  	let F = schlickFresnel( abs( VdotH ), f0 );
  	return base + F * layer;

	}

`, [ schlickFresnelFunc, iorToF0Func ] );

export const conductorFresnelFunc = ( turquinTexture ) => wgslFn( /* wgsl */ `

	fn conductorFresnel( NdotV: f32, VdotH: f32, f0: vec3f, bsdf: vec3f, alpha: f32 ) -> vec3f {

	  let ss = bsdf * schlickFresnelVec( abs( VdotH ), f0, vec3f( 1 ) );

		let uv = vec2( NdotV, sqrt( alpha ) );
		let energySs = max( textureSampleLevel( turquinTexture, turquinTexture_sampler, uv, 0 ).r, 1e-5);

		return ss * ( 1.0 + f0 * ( 1.0 - energySs ) / energySs );

	}

`, [ schlickFresnelVecFunc, turquinTexture ] );

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

			let specular = specularBrdf( NdotL, NdotV, NdotH, alpha );
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
