import { shaderGGXFunctions } from './shaderGGXFunctions.js';
import { shaderSheenFunctions } from './shaderSheenFunctions.js';
import { shaderIridescenceFunctions } from './shaderIridescenceFunctions.js';

/*
wi     : incident vector or light vector (pointing toward the light)
wo     : outgoing vector or view vector (pointing towards the camera)
wh     : computed half vector from wo and wi
Eval   : Get the color and pdf for a direction
Sample : Get the direction, color, and pdf for a sample
eta    : Greek character used to denote the "ratio of ior"
f0     : Amount of light reflected when looking at a surface head on - "fresnel 0"
*/

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
	float eta;
	float f0;
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

float disneyFresnel( SurfaceRec surf, vec3 wo, vec3 wi, vec3 wh ) {

	float dotHV = dot( wo, wh );
	float dotHL = dot( wi, wh );

	// TODO: some model-viewer test models look better when surf.eta is set to a non 1.5 eta here here?
	// and the furnace test seems to pass when it === 1.0
	// float dielectricFresnel = dielectricFresnel( abs( dotHV ), surf.eta );
	float dielectricFresnel = dielectricFresnel( abs( dotHV ), 1.0 / 1.1 );
	float metallicFresnel = schlickFresnel( dotHL, surf.f0 );

	return mix( dielectricFresnel, metallicFresnel, surf.metalness );

}

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

	float FM = disneyFresnel( surf, wo, wi, wh );

	color = ( 1.0 - FM ) * transFactor * metalFactor * wi.z * surf.color * ( retro + lambert ) / PI;
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
	float filteredRoughness = surf.filteredRoughness;

	float eta = surf.eta;
	float f0 = surf.f0;
	float G = ggxShadowMaskG2( wi, wo, filteredRoughness );
	float D = ggxDistribution( wh, filteredRoughness );
	float FM = disneyFresnel( surf, wo, wi, wh );
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	bool cannotRefract = eta * sinTheta > 1.0;
	if ( cannotRefract ) {

		FM = 1.0;

	}

	vec3 metalColor = surf.color;
	vec3 dielectricColor = f0 * surf.specularColor;
	vec3 specColor = mix( dielectricColor, metalColor, surf.metalness );

	vec3 iridescenceF = evalIridescence( 1.0, surf.iridescenceIor, dot( wi, wh ), surf.iridescenceThickness, vec3( f0 ) );
	vec3 iridescenceMix = mix( vec3( FM ), iridescenceF, surf.iridescence );
	vec3 F = mix( specColor, vec3( 1.0 ), iridescenceMix );

	color = mix( surf.specularIntensity, 1.0, surf.metalness ) * wi.z * F * G * D / ( 4.0 * abs( wi.z * wo.z ) );

	// PDF
	// See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
	float incidentTheta = acos( wo.z );
	float G1 = ggxShadowMaskG1( incidentTheta, filteredRoughness );
	float ggxPdf = D * G1 * max( 0.0, abs( dot( wo, wh ) ) ) / abs ( wo.z );
	return ggxPdf / ( 4.0 * dot( wo, wh ) );

}

vec3 specularDirection( vec3 wo, SurfaceRec surf ) {

	// sample ggx vndf distribution which gives a new normal
	float filteredRoughness = surf.filteredRoughness;
	vec3 halfVector = ggxDirection(
		wo,
		vec2( filteredRoughness ),
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

	vec3 col = thinFilm || frontFace ? surf.color : vec3( 1.0 );
	color = surf.transmission * col;

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


	// TODO: support thin film
	vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );
	return normalize( lightDirection );

}
*/

// TODO: This is just using a basic cosine-weighted specular distribution with an
// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRec surf, out vec3 color ) {

	// only attenuate the color if it's on the way in
	vec3 col = surf.thinFilm || surf.frontFace ? surf.color : vec3( 1.0 );
	color = surf.transmission * col;

	// PDF
	float eta = surf.eta;
	float f0 = surf.f0;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnel( cosTheta, f0 );
	bool cannotRefract = eta * sinTheta > 1.0;
	if ( cannotRefract ) {

		return 0.0;

	}

	return 1.0 / ( 1.0 - reflectance );

}

vec3 transmissionDirection( vec3 wo, SurfaceRec surf ) {

	float roughness = surf.roughness;
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
	float filteredClearcoatRoughness = surf.filteredClearcoatRoughness;

	float eta = frontFace ? 1.0 / ior : ior;
	float G = ggxShadowMaskG2( wi, wo, filteredClearcoatRoughness );
	float D = ggxDistribution( wh, filteredClearcoatRoughness );
	float F = schlickFresnel( dot( wi, wh ), f0 );
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	bool cannotRefract = eta * sinTheta > 1.0;
	if ( cannotRefract ) {

		F = 1.0;

	}

	float fClearcoat = F * D * G / ( 4.0 * abs( wi.z * wo.z ) );
	color = color * ( 1.0 - surf.clearcoat * F ) + fClearcoat * surf.clearcoat * wi.z;

	// PDF
	// See equation (27) in http://jcgt.org/published/0003/02/03/
	return ggxPDF( wo, wh, filteredClearcoatRoughness ) / ( 4.0 * dot( wi, wh ) );

}

vec3 clearcoatDirection( vec3 wo, SurfaceRec surf ) {

	// sample ggx vndf distribution which gives a new normal
	float filteredClearcoatRoughness = surf.filteredClearcoatRoughness;
	vec3 halfVector = ggxDirection(
		wo,
		vec2( filteredClearcoatRoughness ),
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
#define DIFF_WEIGHT 0
#define SPEC_WEIGHT 1
#define TRANS_WEIGHT 2
#define CC_WEIGHT 3
void getLobeWeights( vec3 wo, vec3 wi, vec3 wh, vec3 clearcoatWo, SurfaceRec surf, out float[ 4 ] weights ) {

	float metalness = surf.metalness;
	float transmission = surf.transmission;

	float eta = surf.eta;
	float f0 = surf.f0;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );

	// TODO: does "cannot refract" belong in disney fresnel?
	float reflectance = disneyFresnel( surf, wo, wi, wh );
	bool cannotRefract = eta * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float transSpecularProb = mix( max( 0.25, reflectance ), 1.0, metalness );
	float diffSpecularProb = 0.5 + 0.5 * metalness;

	float diffuseWeight = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );
	float specularWeight = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb;
	float transmissionWeight = transmission * ( 1.0 - transSpecularProb );
	float clearcoatWeight = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );

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

	float eta = surf.eta;
	float f0 = surf.f0;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnel( cosTheta, f0 );
	bool cannotRefract = eta * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1.0;

	}

	float spdf = 0.0;
	float dpdf = 0.0;
	float tpdf = 0.0;
	float cpdf = 0.0;
	color = vec3( 0.0 );

	vec3 halfVector = getHalfVector( wi, wo, surf.eta );

	// diffuse
	if ( diffuseWeight > 0.0 && wi.z > 0.0 ) {

		dpdf = diffuseEval( wo, wi, halfVector, surf, color );
		color *= 1.0 - surf.transmission;

	}

	// ggx specular
	if ( specularWeight > 0.0 && wi.z > 0.0 ) {

		vec3 outColor;
		spdf = specularEval( wo, wi, getHalfVector( wi, wo ), surf, outColor );
		color += outColor;

	}

	// transmission
	if ( transmissionWeight > 0.0 && wi.z < 0.0 ) {

		tpdf = transmissionEval( wo, wi, halfVector, surf, color );

	}

	// sheen
	color *= sheenAlbedoScaling( wo, wi, surf );
	color += sheenColor( wo, wi, halfVector, surf );

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

float bsdfResult( vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRec surf, out vec3 color ) {

	float[ 4 ] pdf;
	vec3 wh = getHalfVector( wo, wi, surf.eta );
	getLobeWeights( wo, wi, wh, clearcoatWo, surf, pdf );

	float specularPdf;
	return bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, pdf, specularPdf, color );

}

SampleRec bsdfSample( vec3 wo, vec3 clearcoatWo, mat3 normalBasis, mat3 invBasis, mat3 clearcoatNormalBasis, mat3 clearcoatInvBasis, SurfaceRec surf ) {

	// using normal and basically-reflected ray since we don't have proper half vector here
	float pdf[4];
	getLobeWeights( wo, wo, vec3( 0, 0, 1 ), clearcoatWo, surf, pdf );

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

	float r = sobol( 15 );
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
