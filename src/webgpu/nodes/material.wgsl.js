import { wgslFn } from 'three/tsl';
import { scatterRecordStruct, constants, surfaceRecordStruct, lobeWeightsStruct } from './structs.wgsl';
import {
	sampleSphereCosineFn,
	iorRatioToF0Func,
	applyFilteredGlossyFunc,
	diffuseEvalFunc,
	transmissionEvalFunc,
	specularEvalFunc,
	clearcoatEvalFunc,
	sheenAlbedoScalingFunc,
	sheenColorFunc,
	diffuseDirectionFunc,
	specularDirectionFunc,
	transmissionDirectionFunc,
	clearcoatDirectionFunc,
	getLobeWeightsFunc,
} from './sampling.wgsl';
import { pcgRand, pcgRand2 } from './random.wgsl';
import { getVertexAttribute, intersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { getBasisFromNormalFunc, getPointAttributes, inverseMat3x3Func } from './utils.wgsl.js';
import { getRefractionHalfVectorFunc, getHalfVectorFunc } from './utils.wgsl.js';

export const getSurfaceRecordFunc = wgslFn( /* wgsl */ `

	fn getSurfaceRecord(
		material: Material,
		surfaceHit: IntersectionResult,
		attributes: ptr<storage, array<VertexAttributes>, read>,
	) -> SurfaceRecord {
		let pointAttributes = getPointAttributes( attributes, surfaceHit.indices.xyz, surfaceHit.barycoord );
		let uv = pointAttributes.uv;

		var normal = surfaceHit.normal * surfaceHit.side;
		if ( material.flatShading == 0 ) {

			normal = pointAttributes.normal;

		}

		let baseNormal = normal;
		/* READ TANGENT ATTRIBUTE FOR ANOTHER NORMAL? */

		normal *= surfaceHit.side;

		var albedo = vec4( material.color, material.opacity );

		if ( material.vertexColors == 1 ) {

			let vertexColor = pointAttributes.color;
			albedo *= vec4f( vertexColor, 1.0 );

		}

		var roughness = material.roughness;
		if ( material.roughnessMap != -1 ) {

			let uvPrime = material.roughnessMapTransform * vec3f( uv, 1 );
			/* SAMPLE ROUGHNESS TEXTURE roughness *= */

		}

		var metalness = material.metalness;
		if ( material.metalnessMap != -1 ) {

			let uvPrime = material.metalnessMapTransform * vec3f( uv, 1 );
			/* SAMPLE METALNESS TEXTURE metalness *= */

		}

		var emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.emissiveMapTransform * vec3f( uv, 1 );
			/* SAMPLE EMISSION TEXTURE */
		}

		var transmission = material.transmission;
		if ( material.transmissionMap != -1 ) {

			let uvPrime = material.transmissionMapTransform * vec3f( uv, 1 );
			/* SAMPLE transmission TEXTURE */
		}

		var clearcoat = material.clearcoat;
		if ( material.clearcoatMap != -1 ) {

			let uvPrime = material.clearcoatMapTransform * vec3f( uv, 1 );
			/* SAMPLE clearcoat TEXTURE */
		}

		var clearcoatRoughness = material.clearcoatRoughness;
		if ( material.clearcoatRoughnessMap != -1 ) {

			let uvPrime = material.clearcoatRoughnessMapTransform * vec3f( uv, 1 );
			/* SAMPLE clearcoatRoughness TEXTURE */
		}

		var clearcoatNormal = baseNormal;
		/* SAMPLE clearcoat tangent/normal texture for actual normal */
		clearcoatNormal *= surfaceHit.side;

		var sheenColor = material.sheenColor;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.sheenColorMapTransform * vec3f( uv, 1 );
			/* SAMPLE sheenColor TEXTURE */
		}

		var sheenRoughness = material.sheenRoughness;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.sheenRoughnessMapTransform * vec3f( uv, 1 );
			/* SAMPLE sheenRoughness TEXTURE */
		}

		var iridescence = material.iridescence;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.iridescenceMapTransform * vec3f( uv, 1 );
			/* SAMPLE iridescence TEXTURE */
		}

		var iridescenceThickness = material.iridescenceThicknessMaximum;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.iridescenceThicknessMapTransform * vec3f( uv, 1 );
			/* SAMPLE iridescenceThickness TEXTURE */
		}

		var specularColor = material.specularColor;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.specularColorMapTransform * vec3f( uv, 1 );
			/* SAMPLE specularColor TEXTURE */
		}

		var specularIntensity = material.specularIntensity;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.specularIntensityMapTransform * vec3f( uv, 1 );
			/* SAMPLE specularIntensity TEXTURE */
		}

		var surf: SurfaceRecord;

		surf.volumeParticle = false;
		surf.faceNormal = surfaceHit.normal;
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

		surf.roughness = roughness * roughness;
		surf.clearcoatRoughness = clearcoatRoughness * clearcoatRoughness;
		surf.sheenRoughness = sheenRoughness;

		// frontFace is used to determine transmissive properties and PDF. If no transmission is used
		// then we can just always assume this is a front face.
		surf.frontFace = surfaceHit.side == 1.0 || transmission == 0.0;
		if ( material.thinFilm == 1 || surf.frontFace ) {
			surf.eta = 1.0 / material.ior;
		} else {
			surf.eta = material.ior;
		}
		surf.f0 = iorRatioToF0( surf.eta );

		// Compute the filtered roughness value to use during specular reflection computations.
		// The accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
		// If we're exiting something transmissive then scale the factor down significantly so we can retain
		// sharp internal reflections
		// TODO: accumulate roughness in the main cycle
		let accumulatedRoughness = 0.0;
		surf.filteredRoughness = applyFilteredGlossy( surf.roughness, accumulatedRoughness );
		surf.filteredClearcoatRoughness = applyFilteredGlossy( surf.clearcoatRoughness, accumulatedRoughness );

		// get the normal frames
		surf.normalBasis = getBasisFromNormal( surf.normal );
		surf.normalInvBasis = inverse( surf.normalBasis );

		surf.clearcoatBasis = getBasisFromNormal( surf.clearcoatNormal );
		surf.clearcoatInvBasis = inverse( surf.clearcoatBasis );

		return surf;
	}

`, [
	inverseMat3x3Func,
	iorRatioToF0Func,
	applyFilteredGlossyFunc,
	getBasisFromNormalFunc,
	getVertexAttribute,
	surfaceRecordStruct,
	intersectionResultStruct
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

`, [ scatterRecordStruct, sampleSphereCosineFn, pcgRand2, constants ] );

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
	getPointAttributes,
	lobeWeightsStruct
] );

