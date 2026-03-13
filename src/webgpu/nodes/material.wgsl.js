import { wgslFn } from 'three/tsl';
import {
	inverseMat3x3Func,
	getBasisFromNormalFunc,
	iorToF0Func,
	schlickFresnelFunc,
	schlickFresnelVecFunc,
} from './utils.wgsl';
import { ggxSmithVisibilityFunc, ggxDistributionFunc } from './ggx.wgsl';
import { constants, surfaceRecordStruct, scatterRecordStruct } from './structs.wgsl';
import { sampleSphereCosineFn } from './sampling.wgsl';
import { pcgRand2 } from './random.wgsl';

export const getSurfaceRecordFunc = wgslFn( /* wgsl */ `

	fn getSurfaceRecord(
		material: Material,
		vertexData: bvh_GeometryStruct,
		side: f32,
		hitNormal: vec3f,
		textures: texture_2d_array<f32>,
		textureSampler: sampler,
	) -> SurfaceRecord {
		let uv = vertexData.uv.xy;

		var normal = hitNormal * side;
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
				let bitangent = normalize( cross( normal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, normal );

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
				let bitangent = normalize( cross( normal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, clearcoatNormal );

				let uvPrime = material.clearcoatNormalMapTransform * vec3( uv, 1.0 );
				var texNormal = textureSampleLevel( textures, textureSampler, uvPrime.xy, i32( material.clearcoatNormalMap ), 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.clearcoatNormalScale, 1.0 );
				normal = normalize( vTBN * texNormal );

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
			iridescenceThickness *= texColor.r;

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
		surf.faceNormal = hitNormal;
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
export const diffuseBrdfFunc = wgslFn( /* wgslFn */ `

	fn diffuseBrdf( NdotV: f32, NdotL: f32, VdotH: f32, surf: SurfaceRecord ) -> vec3f {

		// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
		// See equation (4)

		let fl = schlickFresnel( NdotL, 0.0 );
		let fv = schlickFresnel( NdotV, 0.0 );

		let rr = 2.0 * surf.roughness * VdotH * VdotH;
		let retro = rr * ( fl + fv + fl * fv * ( rr - 1.0f ) );
		let fresnel = ( 1.0f - 0.5f * fl ) * ( 1.0f - 0.5f * fv );

		// TODO: subsurface approx?

		return ( surf.color / PI ) * ( retro + fresnel );

	}

`, [ constants, schlickFresnelFunc, surfaceRecordStruct ] );

export const specularBrdfFunc = wgslFn( /* wgslFn */ `

	fn specularBrdf( NdotL: f32, NdotV: f32, NdotH: f32, alpha: f32 ) -> vec3f {

		let Vis = ggxSmithVisibility( NdotV, NdotL, alpha );
		let D = ggxDistribution( NdotH, alpha );

		return vec3f( D * Vis );

	}

`, [ ggxSmithVisibilityFunc, ggxDistributionFunc ] );

export const fresnelMixFunc = wgslFn( /* wgslFn */ `

	fn fresnelMix( VdotH: f32, ior: f32, base: vec3f, layer: vec3f ) -> vec3f {

		let f0 = iorToF0( ior );
  	let F = schlickFresnel( abs( VdotH ), f0 );
  	return base + F * layer;

	}

`, [ schlickFresnelFunc, iorToF0Func ] );

export const conductorFresnelFunc = wgslFn( /* wgslFn */ `

	fn conductorFresnel( VdotH: f32, f0: vec3f, bsdf: vec3f ) -> vec3f {

	  return bsdf * schlickFresnelVec( abs( VdotH ), f0, vec3f( 1 ) );

	}

`, [ schlickFresnelVecFunc ] );
