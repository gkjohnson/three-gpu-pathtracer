export const multiscatter_functions = /* glsl */`

// Explicit Microsurface Multiscattering for GGX
// Based on "Multiple-Scattering Microfacet BSDFs with the Smith Model" (Heitz et al. 2016)
// and "Position-Free Multiple-Bounce Computations for Smith Microfacet BSDFs" (Xie & Hanrahan 2018)
//
// This simulates a random walk on the microsurface, allowing rays to bounce multiple times
// within the microfacet structure before escaping.

// Check if a direction is above the macrosurface
bool isAboveSurface( vec3 w ) {
	return w.z > 0.0;
}

// Sample a microfacet normal visible from direction v
// Returns the microsurface normal in tangent space
vec3 sampleGGXMicrofacet( vec3 v, float roughness, vec2 alpha, vec2 rand ) {
	// Use VNDF sampling (already implemented in ggx_functions)
	return ggxDirection( v, alpha, rand );
}

// Compute Fresnel reflectance for a given cosine
float fresnelSchlick( float cosTheta, float f0 ) {
	float c = 1.0 - cosTheta;
	float c2 = c * c;
	return f0 + ( 1.0 - f0 ) * c2 * c2 * c;
}

// Perform a random walk on the microsurface for multiscatter GGX
// This function traces the path of a ray bouncing within the microfacet structure
// wo: outgoing direction (view direction) in tangent space
// roughness: surface roughness
// f0Color: Fresnel at normal incidence
// Returns: throughput color after microsurface bounces and final exit direction
struct MicrosurfaceScatterResult {
	vec3 direction;  // Final exit direction in tangent space
	vec3 throughput; // Accumulated throughput/color
	bool valid;      // Whether the scatter was successful
};

MicrosurfaceScatterResult ggxMicrosurfaceScatter( vec3 wo, float roughness, vec3 f0Color ) {

	MicrosurfaceScatterResult result;
	result.throughput = vec3( 1.0 );
	result.valid = false;

	// Only enable multiscatter for rough surfaces (roughness > 0.2)
	// For smooth surfaces, single-scatter is sufficient
	if ( roughness < 0.2 ) {
		// Return invalid - use regular single-scatter path
		return result;
	}

	// Current ray direction (starts as view direction)
	vec3 w = wo;
	vec3 throughput = vec3( 1.0 );

	vec2 alpha = vec2( roughness );
	float f0 = ( f0Color.r + f0Color.g + f0Color.b ) / 3.0;

	// Maximum bounces within microsurface (typically 2-4 is enough)
	const int MAX_MICRO_BOUNCES = 3;

	for ( int bounce = 0; bounce < MAX_MICRO_BOUNCES; bounce++ ) {

		// Check if ray escaped the microsurface
		if ( isAboveSurface( w ) && bounce > 0 ) {
			// Ray escaped! Return the result
			result.direction = w;
			result.throughput = throughput;
			result.valid = true;
			return result;
		}

		// If going down on first bounce, reject (shouldn't happen with VNDF)
		if ( bounce == 0 && !isAboveSurface( w ) ) {
			return result;
		}

		// Sample a visible microfacet normal
		vec3 m = sampleGGXMicrofacet( w, roughness, alpha, rand2( 17 + bounce ) );

		// Compute reflection direction
		vec3 wi = reflect( -w, m );

		// Compute Fresnel for this bounce
		float cosTheta = dot( w, m );
		float F = fresnelSchlick( abs( cosTheta ), f0 );

		// Apply Fresnel to throughput
		// For metals, use colored Fresnel
		vec3 fresnelColor = f0Color + ( vec3( 1.0 ) - f0Color ) * pow( 1.0 - abs( cosTheta ), 5.0 );
		throughput *= fresnelColor;

		// Russian roulette for path termination
		if ( bounce > 0 ) {
			float q = max( throughput.r, max( throughput.g, throughput.b ) );
			q = min( q, 0.95 ); // Cap at 95% to ensure termination

			if ( rand( 18 + bounce ) > q ) {
				// Path terminated
				return result;
			}

			// Adjust throughput for RR
			throughput /= q;
		}

		// Update direction for next bounce
		w = wi;

	}

	// If we hit max bounces, check if we're above surface
	if ( isAboveSurface( w ) ) {
		result.direction = w;
		result.throughput = throughput;
		result.valid = true;
	}

	return result;

}

// Stub function for compatibility - not used in explicit multiscatter approach
vec3 ggxMultiScatterCompensation( vec3 wo, vec3 wi, float roughness, vec3 F0 ) {
	// Not used when explicit microsurface scattering is enabled
	return vec3( 0.0 );
}


`;
