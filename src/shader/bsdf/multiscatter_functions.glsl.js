export const multiscatter_functions = /* glsl */`

// Analytical multiscatter energy compensation for GGX BRDF
// Compensates for energy loss due to multiple bounces within the microfacet structure
// Based on observations that rough surfaces at grazing angles lose the most energy
vec3 ggxMultiScatterCompensation( vec3 wo, vec3 wi, float roughness, vec3 F0 ) {
	float NdotV = abs( wo.z );
	float NdotL = abs( wi.z );

	// Energy compensation increases with roughness
	// At roughness=0, no compensation needed (perfect mirror)
	// At roughness=1, significant compensation needed (very rough)
	float a = roughness * roughness;
	float energyFactor = a * sqrt( a );  // Scales as roughness^1.5

	// Angular dependence - more energy lost at grazing angles
	float angularLoss = ( 1.0 - NdotV * 0.9 ) * ( 1.0 - NdotL * 0.9 );

	// Combined energy compensation
	vec3 compensation = F0 * energyFactor * angularLoss;

	// Conservative global scale to avoid over-brightening
	return compensation * 0.25;
}


`;
