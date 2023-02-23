import { ggxGLSL } from './ggx.glsl.js';
import { sheenGLSL } from './sheen.glsl.js';
import { iridescenceGLSL } from './iridescence.glsl.js';

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

export const bsdfSamplingGLSL = /* glsl */`

	struct SurfaceRec {

		// geometry
		vec3 faceNormal;
		bool frontFace;
		vec3 normal;

		// cached properties
		float eta;
		float f0;

		// material
		float roughness;
		float filteredRoughness;
		float metalness;
		vec3 color;
		vec3 emission;

		// transmission
		float ior;
		float transmission;
		bool thinFilm;
		vec3 attenuationColor;
		float attenuationDistance;

		// clearcoat
		vec3 clearcoatNormal;
		float clearcoat;
		float clearcoatRoughness;
		float filteredClearcoatRoughness;

		// sheen
		float sheen;
		vec3 sheenColor;
		float sheenRoughness;

		// iridescence
		float iridescence;
		float iridescenceIor;
		float iridescenceThickness;

		// specular
		vec3 specularColor;
		float specularIntensity;
	};

	struct SampleRec {
		float specularPdf;
		float pdf;
		vec3 direction;
		vec3 color;
	};

	${ ggxGLSL }
	${ sheenGLSL }
	${ iridescenceGLSL }

	// diffuse
	float diffuseEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf, out vec3 color ) {

		// https://schuttejoe.github.io/post/disneybsdf/
		float fl = schlickFresnel( wi.z, 0.0 );
		float fv = schlickFresnel( wo.z, 0.0 );

		float metalFactor = ( 1.0 - surf.metalness );
		float transFactor = ( 1.0 - surf.transmission );
		float rr = 0.5 + 2.0 * surf.roughness * fl * fl;
		float retro = rr * ( fl + fv + fl * fv * ( rr - 1.0f ) );
		float lambert = ( 1.0f - 0.5f * fl ) * ( 1.0f - 0.5f * fv );

		// TODO: subsurface approx?

		float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		color = ( 1.0 - F ) * transFactor * metalFactor * wi.z * surf.color * ( retro + lambert ) / PI;
		return wi.z / PI;

	}

	vec3 diffuseDirection( vec3 wo, SurfaceRec surf ) {

		vec3 lightDirection = sampleSphere( sobol2( 11 ) );
		lightDirection.z += 1.0;
		lightDirection = normalize( lightDirection );

		return lightDirection;

	}

	// specular
	float specularEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf, out vec3 color ) {

		// if roughness is set to 0 then D === NaN which results in black pixels
		float metalness = surf.metalness;
		float roughness = surf.filteredRoughness;

		float eta = surf.eta;
		float f0 = surf.f0;
		float G = ggxShadowMaskG2( wi, wo, roughness );
		float D = ggxDistribution( wh, roughness );

		vec3 f0Color = mix( f0 * surf.specularColor * surf.specularIntensity, surf.color, surf.metalness );
		vec3 f90Color = vec3( mix( surf.specularIntensity, 1.0, surf.metalness ) );
		vec3 F = evaluateFresnel( dot( wo, wh ), eta, f0Color, f90Color );

		vec3 iridescenceF = evalIridescence( 1.0, surf.iridescenceIor, dot( wi, wh ), surf.iridescenceThickness, f0Color );
		F = mix( F, iridescenceF,  surf.iridescence );

		color = wi.z * F * G * D / ( 4.0 * abs( wi.z * wo.z ) );

		// PDF
		// See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
		float incidentTheta = acos( wo.z );
		float G1 = ggxShadowMaskG1( incidentTheta, roughness );
		float ggxPdf = D * G1 * max( 0.0, abs( dot( wo, wh ) ) ) / abs ( wo.z );
		return ggxPdf / ( 4.0 * dot( wo, wh ) );

	}

	vec3 specularDirection( vec3 wo, SurfaceRec surf ) {

		// sample ggx vndf distribution which gives a new normal
		float roughness = surf.filteredRoughness;
		vec3 halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			sobol2( 12 )
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}


	// transmission
	/*
	float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf, out vec3 color ) {

		// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

		float filteredRoughness = surf.filteredRoughness;
		float eta = surf.eta;
		bool frontFace = surf.frontFace;
		bool thinFilm = surf.thinFilm;

		color = surf.transmission * surf.color;

		float denom = pow( eta * dot( wi, wh ) + dot( wo, wh ), 2.0 );
		return ggxPDF( wo, wh, filteredRoughness ) / denom;

	}

	vec3 transmissionDirection( vec3 wo, SurfaceRec surf ) {

		float filteredRoughness = surf.filteredRoughness;
		float eta = surf.eta;
		bool frontFace = surf.frontFace;

		// sample ggx vndf distribution which gives a new normal
		vec3 halfVector = ggxDirection(
			wo,
			vec2( filteredRoughness ),
			sobol2( 13 )
		);

		vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );
		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}

		return normalize( lightDirection );

	}
	*/

	// TODO: This is just using a basic cosine-weighted specular distribution with an
	// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
	float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf, out vec3 color ) {

		color = surf.transmission * surf.color;

		// PDF
		float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		if ( F >= 1.0 ) {

			return 0.0;

		}

		return 1.0 / ( 1.0 - F );

	}

	vec3 transmissionDirection( vec3 wo, SurfaceRec surf ) {

		float roughness = surf.filteredRoughness;
		float eta = surf.eta;
		vec3 halfVector = normalize( vec3( 0.0, 0.0, 1.0 ) + sampleSphere( sobol2( 13 ) ) * roughness );
		vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );

		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}
		return normalize( lightDirection );

	}

	// clearcoat
	float clearcoatEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf, inout vec3 color ) {

		float ior = 1.5;
		float f0 = iorRatioToF0( ior );
		bool frontFace = surf.frontFace;
		float roughness = surf.filteredClearcoatRoughness;

		float eta = frontFace ? 1.0 / ior : ior;
		float G = ggxShadowMaskG2( wi, wo, roughness );
		float D = ggxDistribution( wh, roughness );
		float F = schlickFresnel( dot( wi, wh ), f0 );

		float fClearcoat = F * D * G / ( 4.0 * abs( wi.z * wo.z ) );
		color = color * ( 1.0 - surf.clearcoat * F ) + fClearcoat * surf.clearcoat * wi.z;

		// PDF
		// See equation (27) in http://jcgt.org/published/0003/02/03/
		return ggxPDF( wo, wh, roughness ) / ( 4.0 * dot( wi, wh ) );

	}

	vec3 clearcoatDirection( vec3 wo, SurfaceRec surf ) {

		// sample ggx vndf distribution which gives a new normal
		float roughness = surf.filteredClearcoatRoughness;
		vec3 halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			sobol2( 14 )
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}

	// sheen
	vec3 sheenColor( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf ) {

		float cosThetaO = saturateCos( wo.z );
		float cosThetaI = saturateCos( wi.z );
		float cosThetaH = wh.z;

		float D = velvetD( cosThetaH, surf.sheenRoughness );
		float G = velvetG( cosThetaO, cosThetaI, surf.sheenRoughness );

		// See equation (1) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
		vec3 color = surf.sheenColor;
		color *= D * G / ( 4.0 * abs( cosThetaO * cosThetaI ) );
		color *= wi.z;

		return color;

	}

	// bsdf
	void getLobeWeights(
		vec3 wo, vec3 wi, vec3 wh, vec3 clearcoatWo, SurfaceRec surf,
		out float diffuseWeight, out float specularWeight, out float transmissionWeight, out float clearcoatWeight
	) {

		float metalness = surf.metalness;
		float transmission = surf.transmission;
		float fEstimate = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );

		float transSpecularProb = mix( max( 0.25, fEstimate ), 1.0, metalness );
		float diffSpecularProb = 0.5 + 0.5 * metalness;

		diffuseWeight = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );
		specularWeight = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb;
		transmissionWeight = transmission * ( 1.0 - transSpecularProb );
		clearcoatWeight = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );

		float totalWeight = diffuseWeight + specularWeight + transmissionWeight + clearcoatWeight;
		diffuseWeight /= totalWeight;
		specularWeight /= totalWeight;
		transmissionWeight /= totalWeight;
		clearcoatWeight /= totalWeight;
	}

	float bsdfEval(
		vec3 wo, vec3 wi, SurfaceRec surf,
		float diffuseWeight, float specularWeight, float transmissionWeight, float clearcoatWeight, out float specularPdf, out vec3 color
	) {

		// local frames
		mat3 normalBasis = getBasisFromNormal( surf.normal );
		mat3 invBasis = inverse( normalBasis );

		mat3 clearcoatNormalBasis = getBasisFromNormal( surf.clearcoatNormal );
		mat3 clearcoatInvBasis = inverse( clearcoatNormalBasis );

		vec3 clearcoatWo = clearcoatInvBasis * wo;
		vec3 clearcoatWi = clearcoatInvBasis * wi;

		vec3 localWo = invBasis * wo;
		vec3 localWi = invBasis * wi;

		// evaluate
		float metalness = surf.metalness;
		float transmission = surf.transmission;

		float spdf = 0.0;
		float dpdf = 0.0;
		float tpdf = 0.0;
		float cpdf = 0.0;
		color = vec3( 0.0 );

		vec3 halfVector = getHalfVector( localWi, localWo, surf.eta );

		// diffuse
		if ( diffuseWeight > 0.0 && localWi.z > 0.0 ) {

			dpdf = diffuseEval( localWo, localWi, halfVector, surf, color );
			color *= 1.0 - surf.transmission;

		}

		// ggx specular
		if ( specularWeight > 0.0 && localWi.z > 0.0 ) {

			vec3 outColor;
			spdf = specularEval( localWo, localWi, getHalfVector( localWi, localWo ), surf, outColor );
			color += outColor;

		}

		// transmission
		if ( transmissionWeight > 0.0 && localWi.z < 0.0 ) {

			tpdf = transmissionEval( localWo, localWi, halfVector, surf, color );

		}

		// sheen
		color *= mix( 1.0, sheenAlbedoScaling( localWo, localWi, surf ), surf.sheen );
		color += sheenColor( localWo, localWi, halfVector, surf ) * surf.sheen;

		// clearcoat
		if ( clearcoatWi.z >= 0.0 && clearcoatWeight > 0.0 ) {

			vec3 clearcoatHalfVector = getHalfVector( clearcoatWo, clearcoatWi );
			cpdf = clearcoatEval( clearcoatWo, clearcoatWi, clearcoatHalfVector, surf, color );

		}

		float pdf =
			dpdf * diffuseWeight
			+ spdf * specularWeight
			+ tpdf * transmissionWeight
			+ cpdf * clearcoatWeight;

		// retrieve specular rays for the shadows flag
		specularPdf = spdf * specularWeight + cpdf * clearcoatWeight;

		return pdf;

	}

	float bsdfResult( vec3 wo, vec3 wi, SurfaceRec surf, out vec3 color ) {

		// local frames
		mat3 normalBasis = getBasisFromNormal( surf.normal );
		mat3 invBasis = inverse( normalBasis );

		mat3 clearcoatNormalBasis = getBasisFromNormal( surf.clearcoatNormal );
		mat3 clearcoatInvBasis = inverse( clearcoatNormalBasis );

		vec3 clearcoatWo = clearcoatInvBasis * wo;
		vec3 clearcoatWi = clearcoatInvBasis * wi;

		vec3 localWo = invBasis * wo;
		vec3 localWi = invBasis * wi;

		// evaluate
		vec3 wh = getHalfVector( localWo, localWi, surf.eta );
		float diffuseWeight;
		float specularWeight;
		float transmissionWeight;
		float clearcoatWeight;
		getLobeWeights( localWo, localWi, wh, clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

		float specularPdf;
		return bsdfEval( wo, wi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight, specularPdf, color );

	}

	SampleRec bsdfSample( vec3 wo, SurfaceRec surf ) {

		// local frames
		mat3 normalBasis = getBasisFromNormal( surf.normal );
		mat3 invBasis = inverse( normalBasis );

		mat3 clearcoatNormalBasis = getBasisFromNormal( surf.clearcoatNormal );
		mat3 clearcoatInvBasis = inverse( clearcoatNormalBasis );

		vec3 clearcoatWo = clearcoatInvBasis * wo;
		vec3 localWo = invBasis * wo;

		// evaluate
		float diffuseWeight;
		float specularWeight;
		float transmissionWeight;
		float clearcoatWeight;

		// using normal and basically-reflected ray since we don't have proper half vector here
		getLobeWeights( localWo, localWo, vec3( 0, 0, 1 ), clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

		float pdf[4];
		pdf[0] = diffuseWeight;
		pdf[1] = specularWeight;
		pdf[2] = transmissionWeight;
		pdf[3] = clearcoatWeight;

		float cdf[4];
		cdf[0] = pdf[0];
		cdf[1] = pdf[1] + cdf[0];
		cdf[2] = pdf[2] + cdf[1];
		cdf[3] = pdf[3] + cdf[2];

		if( cdf[3] != 0.0 ) {

			float invMaxCdf = 1.0 / cdf[3];
			cdf[0] *= invMaxCdf;
			cdf[1] *= invMaxCdf;
			cdf[2] *= invMaxCdf;
			cdf[3] *= invMaxCdf;

		} else {

			cdf[0] = 1.0;
			cdf[1] = 0.0;
			cdf[2] = 0.0;
			cdf[3] = 0.0;

		}

		vec3 wi;

		float r = sobol( 15 );
		if ( r <= cdf[0] ) { // diffuse

			wi = diffuseDirection( localWo, surf );

		} else if ( r <= cdf[1] ) { // specular

			wi = specularDirection( localWo, surf );

		} else if ( r <= cdf[2] ) { // transmission / refraction

			wi = transmissionDirection( localWo, surf );

		} else if ( r <= cdf[3] ) { // clearcoat

			vec3 clearcoatWi = clearcoatDirection( clearcoatWo, surf );
			wi = normalize( invBasis * normalize( clearcoatNormalBasis * clearcoatWi ) );

		}

		SampleRec result;
		result.direction = normalBasis * wi;
		result.pdf = bsdfEval( wo, result.direction, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight, result.specularPdf, result.color );

		return result;

	}

`;
