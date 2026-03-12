import { wgslFn } from 'three/tsl';
import {
	inverseMat3x3Func,
	getBasisFromNormalFunc,
	getRefractionHalfVectorFunc,
	getHalfVectorFunc,
} from './utils.wgsl';
import { constants, surfaceRecordStruct, scatterRecordStruct, lobeWeightsStruct } from './structs.wgsl';
import {
	sampleSphereCosineFn,
	diffuseDirectionFunc,
	specularDirectionFunc,
	transmissionDirectionFunc,
	clearcoatDirectionFunc,
	getLobeWeightsFunc,
	diffuseEvalFunc,
	specularEvalFunc,
	transmissionEvalFunc,
	clearcoatEvalFunc,
	sheenColorFunc,
	sheenAlbedoScalingFunc,
} from './sampling.wgsl';
import { pcgRand, pcgRand2 } from './random.wgsl';

export const iorToF0Func = wgslFn( /* wgsl */ `

	fn iorToF0( ior: f32 ) -> f32 {
		return pow( ( 1 - ior ) / ( 1 + ior ), 2 );
	}

` );

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

export const bsdfEvalFunc = wgslFn( /* wgsl */ `

	fn bsdfEval(
		wo: vec3f, clearcoatWo: vec3f, wi: vec3f, clearcoatWi: vec3f,
		surf: SurfaceRecord, weights: LobeWeights
	) -> ScatterRecord {

		let metalness = surf.metalness;
		let transmission = surf.transmission;

		var result: ScatterRecord;
		var spdf = 0.0;
		var dpdf = 0.0;
		var tpdf = 0.0;
		var cpdf = 0.0;
		result.color = vec3( 0.0 );

		// LOOKINTO: Maybe we should calculate half vector earlier to avoid ifs here?
		let halfVector = getRefractionHalfVector( wi, wo, surf.eta );

		// diffuse
		if ( weights.diffuse > 0.0 && wi.z > 0.0 ) {

			dpdf = diffuseEval( wo, wi, halfVector, surf, &result.color );
			result.color *= 1.0 - surf.transmission;

		}

		// ggx specular
		if ( weights.specular > 0.0 && wi.z > 0.0 ) {

			let reflectanceHalfVector = getHalfVector( wi, wo );
			var outColor: vec3f;
			spdf = specularEval( wo, wi, reflectanceHalfVector, surf, &outColor );
			result.color += outColor;

		}

		// transmission
		if ( weights.transmission > 0.0 && wi.z < 0.0 ) {

			tpdf = transmissionEval( wo, wi, halfVector, surf, &result.color );

		}

		// sheen
		result.color *= mix( 1.0, sheenAlbedoScaling( wo, wi, surf ), surf.sheen );
		result.color += sheenColor( wo, wi, halfVector, surf ) * surf.sheen;

		// clearcoat
		if ( clearcoatWi.z >= 0.0 && weights.clearcoat > 0.0 ) {

			let clearcoatHalfVector = getHalfVector( clearcoatWo, clearcoatWi );
			cpdf = clearcoatEval( clearcoatWo, clearcoatWi, clearcoatHalfVector, surf, &result.color );

		}

		result.pdf =
			dpdf * weights.diffuse
			+ spdf * weights.specular
			+ tpdf * weights.transmission
			+ cpdf * weights.clearcoat;

		// retrieve specular rays for the shadows flag
		result.specularPdf = spdf * weights.specular + cpdf * weights.clearcoat;

		return result;

	}

`, [
	getRefractionHalfVectorFunc,
	getHalfVectorFunc,
	diffuseEvalFunc,
	transmissionEvalFunc,
	specularEvalFunc,
	clearcoatEvalFunc,
	sheenAlbedoScalingFunc,
	sheenColorFunc,
	lobeWeightsStruct,
	scatterRecordStruct
] );

export const pbrtBsdfFunc = wgslFn( /* wgsl */`

	fn bsdfSample( worldWo: vec3f, surf: SurfaceRecord ) -> ScatterRecord {

		if ( surf.volumeParticle ) {

			var result: ScatterRecord;
			result.specularPdf = 0.0;
			result.pdf = 1.0 / ( 4.0 * PI );
			result.direction = sampleSphere( pcgRand2() );
			result.color = surf.color / ( 4.0 * PI );
			return result;

		}

		let wo = normalize( surf.normalInvBasis * worldWo );
		let clearcoatWo = normalize( surf.clearcoatInvBasis * worldWo );
		let normalBasis = surf.normalBasis;
		let invBasis = surf.normalInvBasis;
		let clearcoatNormalBasis = surf.clearcoatBasis;
		let clearcoatInvBasis = surf.clearcoatInvBasis;

		// using normal and basically-reflected ray since we don't have proper half vector here
		let weights = getLobeWeights( wo, wo, vec3( 0, 0, 1 ), clearcoatWo, surf );

		let pdf = vec4f( weights.diffuse, weights.specular, weights.transmission, weights.clearcoat );
		var cdf: vec4f;
		cdf.x = pdf.x;
		cdf.y = pdf.y + cdf.x;
		cdf.z = pdf.z + cdf.y;
		cdf.w = pdf.w + cdf.z;

		if( cdf.w != 0.0 ) {

			let invMaxCdf = 1.0 / cdf.w;
			cdf *= invMaxCdf;

		} else {

			cdf = vec4f( 1.0, 0.0, 0.0, 0.0 );

		}

		var wi: vec3f;
		var clearcoatWi: vec3f;

		let r = pcgRand();
		if ( r <= cdf[0] ) { // diffuse

			wi = diffuseDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[1] ) { // specular

			wi = specularDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[2] ) { // transmission / refraction

			wi = transmissionDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[3] ) { // clearcoat

			clearcoatWi = clearcoatDirection( clearcoatWo, surf );
			wi = normalize( invBasis * normalize( clearcoatNormalBasis * clearcoatWi ) );

		}

		var result = bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, weights );
		result.direction = normalize( surf.normalBasis * wi );

		return result;

	}

`, [
	constants,
	diffuseDirectionFunc,
	specularDirectionFunc,
	transmissionDirectionFunc,
	clearcoatDirectionFunc,
	bsdfEvalFunc,
	getLobeWeightsFunc,
	pcgRand,
	lobeWeightsStruct
] );
