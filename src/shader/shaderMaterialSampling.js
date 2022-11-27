import { shaderGGXFunctions } from './shaderGGXFunctions.js';
import { shaderSheenFunctions } from './shaderSheenFunctions.js';
import { shaderIridescenceFunctions } from './shaderIridescenceFunctions.js';

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
	bool thinFilm;
	float ior;
	float iorRatio;
	float clearcoat;
	float clearcoatRoughness;
	float filteredClearcoatRoughness;
	vec3 sheenColor;
	float sheenRoughness;
	float iridescence;
	float iridescenceIor;
	float iridescenceThickness;
	vec3 specularColor;
	float specularIntensity;
	vec3 attenuationColor;
	float attenuationDistance;
};

struct SampleRec {
	float specularPdf;
	float pdf;
	vec3 direction;
	vec3 clearcoatDirection;
	vec3 color;
};

${ shaderGGXFunctions }
${ shaderSheenFunctions }
${ shaderIridescenceFunctions }

// diffuse
float diffuseEval( vec3 wo, vec3 wi, SurfaceRec surf, out vec3 color ) {

	// TODO: scale by 1 - F here
	// note on division by PI
	// https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
	float metalFactor = ( 1.0 - surf.metalness );
	color = surf.color * metalFactor * wi.z / PI;

	// PDF
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

// specular
float specularEval( vec3 wo, vec3 wi, SurfaceRec surf, out vec3 color ) {

	// if roughness is set to 0 then D === NaN which results in black pixels
	float metalness = surf.metalness;
	float filteredRoughness = surf.filteredRoughness;

	vec3 halfVector = getHalfVector( wo, wi );
	float iorRatio = surf.iorRatio;
	float G = ggxShadowMaskG2( wi, wo, filteredRoughness );
	float D = ggxDistribution( halfVector, filteredRoughness );

	float f0 = iorRatioToF0( iorRatio );
	vec3 F = vec3( schlickFresnel( dot( wi, halfVector ), f0 ) );

	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		F = vec3( 1.0 );

	}

	vec3 iridescenceFresnel = evalIridescence( 1.0, surf.iridescenceIor, dot( wi, halfVector ), surf.iridescenceThickness, vec3( f0 ) );
	vec3 metalF = mix( F, iridescenceFresnel, surf.iridescence );
	vec3 dialectricF = F * surf.specularIntensity;
	F = mix( dialectricF, metalF, metalness );

	color = mix( surf.specularColor, surf.color, metalness );
	color = mix( color, vec3( 1.0 ), F );
	color *= G * D / ( 4.0 * abs( wi.z * wo.z ) );
	color *= mix( F, vec3( 1.0 ), metalness );
	color *= wi.z; // scale the light by the direction the light is coming in from

	// PDF
	// See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
	float incidentTheta = acos( wo.z );
	float G1 = ggxShadowMaskG1( incidentTheta, filteredRoughness );
	float ggxPdf = D * G1 * max( 0.0, abs( dot( wo, halfVector ) ) ) / abs ( wo.z );
	return ggxPdf / ( 4.0 * dot( wo, halfVector ) );

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

/*
// transmission
function transmissionEval( wo, wi, material, surf ) {

	// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? ior : 1 / ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	halfVector.set( 0, 0, 0 ).addScaledVector( wi, ratio ).addScaledVector( wo, 1.0 ).normalize().multiplyScalar( - 1 );

	const denom = Math.pow( ratio * halfVector.dot( wi ) + 1.0 * halfVector.dot( wo ), 2.0 );
	return ggxPDF( wo, halfVector, minRoughness ) / denom;

}

function transmissionColor( wo, wi, material, hit, colorTarget ) {

	const { metalness, transmission } = material;
	colorTarget
		.copy( material.color )
		.multiplyScalar( ( 1.0 - metalness ) * wo.z )
		.multiplyScalar( transmission );

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
*/

// TODO: This is just using a basic cosine-weighted specular distribution with an
// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
float transmissionEval( vec3 wo, vec3 wi, SurfaceRec surf, out vec3 color ) {

	// only attenuate the color if it's on the way in
	vec3 col = surf.thinFilm || surf.frontFace ? surf.color : vec3( 1.0 );
	color = surf.transmission * col;

	// PDF
	float iorRatio = surf.iorRatio;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, iorRatio );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		return 0.0;

	}

	return 1.0 / ( 1.0 - reflectance );

}

vec3 transmissionDirection( vec3 wo, SurfaceRec surf ) {

	float roughness = surf.roughness;
	float iorRatio = surf.iorRatio;

	vec3 halfVector = normalize( vec3( 0.0, 0.0, 1.0 ) + randDirection() * roughness );
	vec3 lightDirection = refract( normalize( - wo ), halfVector, iorRatio );

	if ( surf.thinFilm ) {

		lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / iorRatio );

	}
	return normalize( lightDirection );

}


// clearcoat
float clearcoatEval( vec3 wo, vec3 wi, SurfaceRec surf, inout vec3 color ) {

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

	// PDF
	// See equation (27) in http://jcgt.org/published/0003/02/03/
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

// sheen
vec3 sheenColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	vec3 halfVector = getHalfVector( wo, wi );

	float cosThetaO = saturateCos( wo.z );
	float cosThetaI = saturateCos( wi.z );
	float cosThetaH = halfVector.z;

	float D = velvetD( cosThetaH, surf.sheenRoughness );
	float G = velvetG( cosThetaO, cosThetaI, surf.sheenRoughness );

	// See equation (1) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	vec3 color = surf.sheenColor;
	color *= D * G / ( 4.0 * abs( cosThetaO * cosThetaI ) );
	color *= wi.z;

	return color;

}

// bsdf
#define DIFF_WEIGHT 0
#define SPEC_WEIGHT 1
#define TRANS_WEIGHT 2
#define CC_WEIGHT 3
void getLobeWeights( vec3 wo, vec3 clearcoatWo, SurfaceRec surf, out float[ 4 ] weights ) {

	float metalness = surf.metalness;
	float transmission = surf.transmission;

	// TODO: we should compute a half vector ahead of time and pass it into the sampling functions
	// so all functions will use the same half vector
	float iorRatio = surf.iorRatio;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, iorRatio );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float transSpecularProb = mix( reflectance, 1.0, metalness );
	float diffSpecularProb = 0.5 + 0.5 * metalness;

	float clearcoatWeight = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );
	float diffuseWeight = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb ) * ( 1.0 - clearcoatWeight );
	float specularWeight = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb * ( 1.0 - clearcoatWeight );
	float transmissionWeight = transmission * ( 1.0 - transSpecularProb ) * ( 1.0 - clearcoatWeight );

	float totalWeight = diffuseWeight + specularWeight + transmissionWeight + clearcoatWeight;
	weights[ DIFF_WEIGHT ] = diffuseWeight / totalWeight;
	weights[ SPEC_WEIGHT ] = specularWeight / totalWeight;
	weights[ TRANS_WEIGHT ] = transmissionWeight / totalWeight;
	weights[ CC_WEIGHT ] = clearcoatWeight / totalWeight;

}

float bsdfEval( vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRec surf, float[ 4 ] weights, out float specularPdf, out vec3 color ) {

	float diffuseWeight = weights[ DIFF_WEIGHT ];
	float specularWeight = weights[ SPEC_WEIGHT ];
	float transmissionWeight = weights[ TRANS_WEIGHT ];
	float clearcoatWeight = weights[ CC_WEIGHT ];

	float metalness = surf.metalness;
	float transmission = surf.transmission;

	float iorRatio = surf.iorRatio;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, iorRatio );
	bool cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float spdf = 0.0;
	float dpdf = 0.0;
	float tpdf = 0.0;
	float cpdf = 0.0;
	color = vec3( 0.0 );
	if ( wi.z < 0.0 ) {

		if( transmissionWeight > 0.0 ) {

			tpdf = transmissionEval( wo, wi, surf, color );

		}

	} else {

		if( diffuseWeight > 0.0 ) {

			dpdf = diffuseEval( wo, wi, surf, color );
			color *= 1.0 - surf.transmission;

		}

		if( specularWeight > 0.0 ) {

			vec3 outColor;
			spdf = specularEval( wo, wi, surf, outColor );
			color += outColor;

		}

		color *= sheenAlbedoScaling( wo, wi, surf );
		color += sheenColor( wo, wi, surf );

	}

	if( clearcoatWi.z >= 0.0 && clearcoatWeight > 0.0 ) {

		cpdf = clearcoatEval( clearcoatWo, clearcoatWi, surf, color );

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

float bsdfResult( vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRec surf, out float specularPdf, out vec3 color ) {

	float[ 4 ] pdf;
	getLobeWeights( wo, clearcoatWo, surf, pdf );
	return bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, pdf, specularPdf, color );

}

SampleRec bsdfSample( vec3 wo, vec3 clearcoatWo, mat3 normalBasis, mat3 invBasis, mat3 clearcoatNormalBasis, mat3 clearcoatInvBasis, SurfaceRec surf ) {

	float pdf[4];
	getLobeWeights( wo, clearcoatWo, surf, pdf );

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

	SampleRec result;
	result.pdf = bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, pdf, result.specularPdf, result.color );
	result.direction = wi;
	result.clearcoatDirection = clearcoatWi;

	return result;

}
`;
