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
};

struct SampleRec {
	float pdf;
	vec3 direction;
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

	// See equation (17) in http://jcgt.org/published/0003/02/03/
	float filteredRoughness = surf.filteredRoughness;
	vec3 halfVector = getHalfVector( wi, wo );
	return ggxPDF( wi, halfVector, filteredRoughness ) / ( 4.0 * dot( wi, halfVector ) );

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

float bsdfPdf( vec3 wo, vec3 wi, SurfaceRec surf ) {

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

	if ( wi.z < 0.0 ) {

		tpdf = transmissionPDF( wo, wi, surf );

	} else {

		spdf = specularPDF( wo, wi, surf );
		dpdf = diffusePDF( wo, wi, surf );

	}

	float transSpecularProb = mix( reflectance, 1.0, metalness );
	float diffSpecularProb = 0.5 + 0.5 * metalness;
	float pdf =
		spdf * transmission * transSpecularProb
		+ tpdf * transmission * ( 1.0 - transSpecularProb )
		+ spdf * ( 1.0 - transmission ) * diffSpecularProb
		+ dpdf * ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );

	return pdf;

}

vec3 bsdfColor( vec3 wo, vec3 wi, SurfaceRec surf ) {

	vec3 color = vec3( 0.0 );
	if ( wi.z < 0.0 ) {

		color = transmissionColor( wo, wi, surf );

	} else {

		color = diffuseColor( wo, wi, surf );
		color *= 1.0 - surf.transmission;

		color += specularColor( wo, wi, surf );

	}

	return color;

}

SampleRec bsdfSample( vec3 wo, SurfaceRec surf ) {

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

	SampleRec result;
	if ( rand() < transmission ) {

		float specularProb = mix( reflectance, 1.0, metalness );
		if ( rand() < specularProb ) {

			result.direction = specularDirection( wo, surf );

		} else {

			result.direction = transmissionDirection( wo, surf );

		}

	} else {

		float specularProb = 0.5 + 0.5 * metalness;
		if ( rand() < specularProb ) {

			result.direction = specularDirection( wo, surf );

		} else {

			result.direction = diffuseDirection( wo, surf );

		}

	}

	result.pdf = bsdfPdf( wo, result.direction, surf );
	result.color = bsdfColor( wo, result.direction, surf );
	return result;

}
`;
