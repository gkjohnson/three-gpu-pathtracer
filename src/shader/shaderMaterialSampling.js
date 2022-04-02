export const shaderMaterialSampling = /* glsl */`

struct SurfaceRec {
	vec3 normal;
	vec3 faceNormal;
	bool frontFace;
};

struct MaterialRec {
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

// diffuse
float diffusePDF( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
	float cosValue = wi.z;
	return cosValue / PI;

}

vec3 diffuseDirection( vec3 wo, SurfaceRec hit, MaterialRec material ) {

	vec3 lightDirection = randDirection();
	lightDirection.z += 1.0;
	lightDirection = normalize( lightDirection );

	return lightDirection;

}

vec3 diffuseColor( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	// TODO: scale by 1 - F here
	// note on division by PI
	// https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
	float metalFactor = ( 1.0 - material.metalness ) * wi.z / ( PI * PI );
	float transmissionFactor = 1.0 - material.transmission;
	return material.color * metalFactor * transmissionFactor;

}

// specular
float specularPDF( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	// See equation (17) in http://jcgt.org/published/0003/02/03/
	float filteredRoughness = material.filteredRoughness;
	vec3 halfVector = getHalfVector( wi, wo );
	return ggxPDF( wi, halfVector, filteredRoughness ) / ( 4.0 * dot( wi, halfVector ) );

}

vec3 specularDirection( vec3 wo, SurfaceRec hit, MaterialRec material ) {

	// sample ggx vndf distribution which gives a new normal
	float filteredRoughness = material.filteredRoughness;
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

vec3 specularColor( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	// if roughness is set to 0 then D === NaN which results in black pixels
	float metalness = material.metalness;
	float ior = material.ior;
	bool frontFace = hit.frontFace;
	float filteredRoughness = material.filteredRoughness;

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

	vec3 color = mix( vec3( 1.0 ), material.color, metalness );
	color *= G * D / ( 4.0 * abs( wi.z * wo.z ) );
	color *= mix( F, 1.0, metalness );
	color *= wi.z; // scale the light by the direction the light is coming in from

	return color;

}

/*
// transmission
function transmissionPDF( wo, wi, material, hit ) {

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
float transmissionPDF( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	return 1.0;

}

vec3 transmissionDirection( vec3 wo, SurfaceRec hit, MaterialRec material ) {

	float roughness = material.roughness;
	float ior = material.ior;
	bool frontFace = hit.frontFace;
	float ratio = frontFace ? 1.0 / ior : ior;

	// TODO: is this right?
	vec3 lightDirection = refract( - wo, vec3( 0.0, 0.0, 1.0 ), ratio );
	lightDirection += randDirection() * roughness;
	return normalize( lightDirection );

}

vec3 transmissionColor( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	float metalness = material.metalness;
	float transmission = material.transmission;
	float ior = material.ior;
	bool frontFace = hit.frontFace;

	float ratio = frontFace ? 1.0 / ior : ior;
	float cosTheta = min( wo.z, 1.0 );
	float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
	float reflectance = schlickFresnelFromIor( cosTheta, ratio );

	vec3 color = material.color;
	color *= ( 1.0 - metalness );
	color *= 1.0 - reflectance;
	color *= transmission;

	// Color is clamped to [0, 1] to make up for incorrect PDF and over sampling
	color.r = min( color.r, 1.0 );
	color.g = min( color.g, 1.0 );
	color.b = min( color.b, 1.0 );
	return color;

}

float bsdfPdf( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	float ior = material.ior;
	float metalness = material.metalness;
	float transmission = material.transmission;
	bool frontFace = hit.frontFace;

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

		tpdf = transmissionPDF( wo, wi, material, hit );

	} else {

		spdf = specularPDF( wo, wi, material, hit );
		dpdf = diffusePDF( wo, wi, material, hit );

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

vec3 bsdfColor( vec3 wo, vec3 wi, MaterialRec material, SurfaceRec hit ) {

	vec3 color = vec3( 0.0 );
	if ( wi.z < 0.0 ) {

		color = transmissionColor( wo, wi, material, hit );

	} else {

		color = diffuseColor( wo, wi, material, hit );
		color *= 1.0 - material.transmission;

		color += specularColor( wo, wi, material, hit );

	}

	return color;

}

SampleRec bsdfSample( vec3 wo, SurfaceRec hit, MaterialRec material ) {

	float ior = material.ior;
	float metalness = material.metalness;
	float transmission = material.transmission;
	bool frontFace = hit.frontFace;

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

			result.direction = specularDirection( wo, hit, material );

		} else {

			result.direction = transmissionDirection( wo, hit, material );

		}

	} else {

		float specularProb = 0.5 + 0.5 * metalness;
		if ( rand() < specularProb ) {

			result.direction = specularDirection( wo, hit, material );

		} else {

			result.direction = diffuseDirection( wo, hit, material );

		}

	}

	result.pdf = bsdfPdf( wo, result.direction, material, hit );
	result.color = bsdfColor( wo, result.direction, material, hit );
	return result;

}
`;
