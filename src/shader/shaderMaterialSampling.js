import { shaderGGXFunctions } from './shaderGGXFunctions.js';

export const shaderMaterialSampling = /* glsl */`

struct SurfaceRec {
	vec3 normal;
	vec3 faceNormal;
	bool frontFace;
	float roughness;
	float filteredRoughness;
	float metalness;
	vec3 color;
	vec3 emission;
	float transmission;
	float ior;
	float clearcoat;
	float clearcoatRoughness;
	float filteredClearcoatRoughness;
};

struct SampleRec {
	float specularPdf;
	float pdf;
	vec3 direction;
	vec3 clearcoatDirection;
	vec3 color;
};

${ shaderGGXFunctions }

// diffuse
float diffusePDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
	float cosValue = wi.z;
	return cosValue / PI;

}

vec3 diffuseDirection( vec3 wo, SurfaceRec surf ) {

	vec3 lightDirection = randDirection();
	lightDirection.z += 1.0;
	lightDirection = normalize( lightDirection );

	return lightDirection;

}

vec3 diffuseColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// TODO: scale by 1 - F here
	// note on division by PI
	// https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
	float metalFactor = ( 1.0 - surf.metalness ) * wi.z / ( PI * PI );
	float transmissionFactor = 1.0 - surf.transmission;
	return surf.color * metalFactor * transmissionFactor;

}

// specular
float specularPDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// See equation (27) in http://jcgt.org/published/0003/02/03/
	float filteredRoughness = surf.filteredRoughness;
	vec3 halfVector = getHalfVector( wi, wo );
	return ggxPDF( wo, halfVector, filteredRoughness ) / ( 4.0 * dot( wi, halfVector ) );

}

vec3 specularDirection( vec3 wo, SurfaceRec surf ) {

	// sample ggx vndf distribution which gives a new normal
	float filteredRoughness = surf.filteredRoughness;
	vec3 halfVector = ggxDirection(
		wo,
		filteredRoughness,
		filteredRoughness,
		rand(),
		rand()
	);

	// apply to new ray by reflecting off the new normal
	return - reflect( wo, halfVector );

}

vec3 specularColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// if roughness is set to 0 then D === NaN which results in black pixels
	float metalness = surf.metalness;
	float ior = surf.ior;
	bool frontFace = surf.frontFace;
	float filteredRoughness = surf.filteredRoughness;

	vec3 halfVector = getHalfVector( wo, wi );
	float iorRatio = frontFace ? 1.0 / ior : ior;
	float G = ggxShadowMaskG2( wi, wo, filteredRoughness );
	float D = ggxDistribution( halfVector, filteredRoughness );

	float F = schlickFresnelFromIor( dot( wi, halfVector ), iorRatio );
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		F = 1.0;

	}

	vec3 color = mix( vec3( 1.0 ), surf.color, metalness );
	color = mix( color, vec3( 1.0 ), F );
	color *= G * D / ( 4.0 * abs( wi.z * wo.z ) );
	color *= mix( F, 1.0, metalness );
	color *= wi.z; // scale the light by the direction the light is coming in from

	return color;

}

/*
// transmission
function transmissionPDF( wo, wi, material, surf ) {

	// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? ior : 1 / ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	halfVector.set( 0, 0, 0 ).addScaledVector( wi, ratio ).addScaledVector( wo, 1.0 ).normalize().multiplyScalar( - 1 );

	const denom = Math.pow( ratio * halfVector.dot( wi ) + 1.0 * halfVector.dot( wo ), 2.0 );
	return ggxPDF( wo, halfVector, minRoughness ) / denom;

}

function transmissionDirection( wo, hit, material, lightDirection ) {

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	// sample ggx vndf distribution which gives a new normal
	ggxDirection(
		wo,
		minRoughness,
		minRoughness,
		Math.random(),
		Math.random(),
		halfVector,
	);

	// apply to new ray by reflecting off the new normal
	tempDir.copy( wo ).multiplyScalar( - 1 );
	refract( tempDir, halfVector, ratio, lightDirection );

}

function transmissionColor( wo, wi, material, hit, colorTarget ) {

	const { metalness, transmission } = material;
	colorTarget
		.copy( material.color )
		.multiplyScalar( ( 1.0 - metalness ) * wo.z )
		.multiplyScalar( transmission );

}
*/

// TODO: This is just using a basic cosine-weighted specular distribution with an
// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
float transmissionPDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	float ior = surf.ior;
	bool frontFace = surf.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );
	bool cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		return 0.0;

	}

	return 1.0 / ( 1.0 - reflectance );

}

vec3 transmissionDirection( vec3 wo, SurfaceRec surf ) {

	float roughness = surf.roughness;
	float ior = surf.ior;
	bool frontFace = surf.frontFace;
	float ratio = frontFace ? 1.0 / ior : ior;

	vec3 lightDirection = refract( - wo, vec3( 0.0, 0.0, 1.0 ), ratio );
	lightDirection += randDirection() * roughness;
	return normalize( lightDirection );

}

vec3 transmissionColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	float metalness = surf.metalness;
	float transmission = surf.transmission;

	vec3 color = surf.color;
	color *= ( 1.0 - metalness );
	color *= transmission;

	return color;

}

// clearcoat
float clearcoatPDF( vec3 wo, vec3 wi, SurfaceRec surf ) {

	// See equation (27) in http://jcgt.org/published/0003/02/03/
	float filteredClearcoatRoughness = surf.filteredClearcoatRoughness;
	vec3 halfVector = getHalfVector( wi, wo );
	return ggxPDF( wo, halfVector, filteredClearcoatRoughness ) / ( 4.0 * dot( wi, halfVector ) );

}

vec3 clearcoatDirection( vec3 wo, SurfaceRec surf ) {

	// sample ggx vndf distribution which gives a new normal
	float filteredClearcoatRoughness = surf.filteredClearcoatRoughness;
	vec3 halfVector = ggxDirection(
		wo,
		filteredClearcoatRoughness,
		filteredClearcoatRoughness,
		rand(),
		rand()
	);

	// apply to new ray by reflecting off the new normal
	return - reflect( wo, halfVector );

}

void clearcoatColor( inout vec3 color, vec3 wo, vec3 wi, SurfaceRec surf ) {

	float ior = 1.5;
	bool frontFace = surf.frontFace;
	float filteredClearcoatRoughness = surf.filteredClearcoatRoughness;

	vec3 halfVector = getHalfVector( wo, wi );
	float iorRatio = frontFace ? 1.0 / ior : ior;
	float G = ggxShadowMaskG2( wi, wo, filteredClearcoatRoughness );
	float D = ggxDistribution( halfVector, filteredClearcoatRoughness );

	float F = schlickFresnelFromIor( dot( wi, halfVector ), ior );
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		F = 1.0;

	}

	float fClearcoat = F * D * G / ( 4.0 * abs( wi.z * wo.z ) );

	color = color * ( 1.0 - surf.clearcoat * F ) + fClearcoat * surf.clearcoat * wi.z;

}

void getLobeWeights( vec3 wo, vec3 clearcoatWo, SurfaceRec surf, out float diffuseWeight, out float specularWeight, out float transmissionWeight, out float clearcoatWeight ) {

	float ior = surf.ior;
	float metalness = surf.metalness;
	float transmission = surf.transmission;
	bool frontFace = surf.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );
	bool cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float transSpecularProb = mix( reflectance, 1.0, metalness );
	float diffSpecularProb = 0.5 + 0.5 * metalness;

	clearcoatWeight = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );
	diffuseWeight = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb ) * ( 1.0 - clearcoatWeight );
	specularWeight = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb * ( 1.0 - clearcoatWeight );
	transmissionWeight = transmission * ( 1.0 - transSpecularProb ) * ( 1.0 - clearcoatWeight );

	float totalWeight = diffuseWeight + specularWeight + transmissionWeight + clearcoatWeight;
	float invTotalWeight = 1.0 / totalWeight;

	diffuseWeight *= invTotalWeight;
	specularWeight *= invTotalWeight;
	transmissionWeight *= invTotalWeight;
	clearcoatWeight *= invTotalWeight;

}

float bsdfPdf( vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRec surf, out float specularPdf, float diffuseWeight, float specularWeight, float transmissionWeight, float clearcoatWeight ) {

	float ior = surf.ior;
	float metalness = surf.metalness;
	float transmission = surf.transmission;
	bool frontFace = surf.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );
	bool cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float spdf = 0.0;
	float dpdf = 0.0;
	float tpdf = 0.0;
	float cpdf = 0.0;

	if ( wi.z < 0.0 ) {

		if( transmissionWeight > 0.0 ) {

			tpdf = transmissionPDF( wo, wi, surf );

		}

	} else {

		if( diffuseWeight > 0.0 ) {

			dpdf = diffusePDF( wo, wi, surf );

		}

		if( specularWeight > 0.0 ) {

			spdf = specularPDF( wo, wi, surf );

		}

	}

	if( clearcoatWi.z >= 0.0 && clearcoatWeight > 0.0 ) {

		cpdf = clearcoatPDF( clearcoatWo, clearcoatWi, surf );

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

vec3 bsdfColor( vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRec surf, float diffuseWeight, float specularWeight, float transmissionWeight, float clearcoatWeight ) {

	vec3 color = vec3( 0.0 );
	if ( wi.z < 0.0 ) {

		if( transmissionWeight > 0.0 ) {

			color = transmissionColor( wo, wi, surf );

		}

	} else {

		if( diffuseWeight > 0.0 ) {

			color = diffuseColor( wo, wi, surf );
			color *= 1.0 - surf.transmission;

		}

		if( specularWeight > 0.0 ) {

			color += specularColor( wo, wi, surf );

		}

	}

	if( clearcoatWi.z >= 0.0 && clearcoatWeight > 0.0 ) {

		clearcoatColor( color, clearcoatWo, clearcoatWi, surf );

	}

	return color;

}

float bsdfResult( vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRec surf, out vec3 color ) {

	float diffuseWeight;
	float specularWeight;
	float transmissionWeight;
	float clearcoatWeight;
	getLobeWeights( wo, clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

	float specularPdf;
	color = bsdfColor( wo, clearcoatWo, wi, clearcoatWi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );
	return bsdfPdf( wo, clearcoatWo, wi, clearcoatWi, surf, specularPdf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

}

SampleRec bsdfSample( vec3 wo, vec3 clearcoatWo, mat3 normalBasis, mat3 invBasis, mat3 clearcoatNormalBasis, mat3 clearcoatInvBasis, SurfaceRec surf ) {

	float diffuseWeight;
	float specularWeight;
	float transmissionWeight;
	float clearcoatWeight;
	getLobeWeights( wo, clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

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
	vec3 clearcoatWi;

	float r = rand();
	if ( r <= cdf[0] ) {

		wi = diffuseDirection( wo, surf );
		clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

	} else if ( r <= cdf[1] ) {

		wi = specularDirection( wo, surf );
		clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

	} else if ( r <= cdf[2] ) {

		wi = transmissionDirection( wo, surf );
		clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

	} else if ( r <= cdf[3] ) {

		clearcoatWi = clearcoatDirection( clearcoatWo, surf );
		wi = normalize( invBasis * normalize( clearcoatNormalBasis * clearcoatWi ) );

	}

	SampleRec result;
	result.pdf = bsdfPdf( wo, clearcoatWo, wi, clearcoatWi, surf, result.specularPdf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );
	result.color = bsdfColor( wo, clearcoatWo, wi, clearcoatWi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );
	result.direction = wi;
	result.clearcoatDirection = clearcoatWi;

	return result;

}
`;
