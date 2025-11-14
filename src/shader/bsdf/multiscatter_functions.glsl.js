export const multiscatter_functions = /* glsl */`

// GGX Multiscatter Energy Compensation
// Implementation based on Blender Cycles' approach
//
// References:
// - "Multiple-Scattering Microfacet BSDFs with the Smith Model" (Heitz et al. 2016)
// - Blender Cycles: intern/cycles/kernel/closure/bsdf_microfacet_multi.h
//
// Single-scatter GGX loses energy due to rays bouncing multiple times within
// the microfacet structure before escaping. This compensation adds back the
// missing energy as a diffuse-like multiscatter lobe.
//
// The approach uses a fitted albedo approximation to estimate how much energy
// single-scatter captures, then adds the remainder back. This is simpler and
// faster than full random-walk multiscatter simulation while providing good
// energy conservation for path tracers.

// Directional albedo approximation for single-scatter GGX
// Returns the fraction of energy captured by single-scatter as a function of roughness
// Fitted curve from Blender Cycles based on precomputed ground truth data
float ggxAlbedo( float roughness ) {
	float r2 = roughness * roughness;
	return 0.806495 * exp( -1.98712 * r2 ) + 0.199531;
}

// GGX multiscatter energy compensation term
// wo: outgoing direction (view direction)
// wi: incident direction (light direction)
// roughness: surface roughness [0, 1]
// F0: Fresnel reflectance at normal incidence
// Returns: Additional BRDF contribution to compensate for multiscatter energy loss
vec3 ggxMultiScatterCompensation( vec3 wo, vec3 wi, float roughness, vec3 F0 ) {
	// Estimate the fraction of energy captured by single-scatter GGX
	float singleScatterAlbedo = ggxAlbedo( roughness );

	// The missing energy that needs compensation
	float missingEnergy = 1.0 - singleScatterAlbedo;

	// Average Fresnel reflectance over all directions (spherical albedo)
	// Approximation: F_avg ≈ F0 + (1 - F0) / 21
	vec3 Favg = F0 + ( 1.0 - F0 ) / 21.0;

	// Multiscatter contribution: diffuse-like lobe scaled by average Fresnel
	// This represents energy that bounced multiple times before escaping
	vec3 Fms = Favg * missingEnergy;

	// Return as a Lambertian BRDF (energy / π)
	// The π accounts for the hemispherical integral in the rendering equation
	return Fms / PI;
}


`;
