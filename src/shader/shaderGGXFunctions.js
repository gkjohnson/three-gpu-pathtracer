export const shaderGGXFunctions = /* glsl */`
// The GGX functions provide sampling and distribution information for normals as output so
// in order to get probability of scatter direction the half vector must be computed and provided.
// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
// [2] http://jcgt.org/published/0007/04/01/
// [4] http://jcgt.org/published/0003/02/03/

// trowbridge-reitz === GGX === GTR

vec3 ggxDirection( vec3 incidentDir, vec2 roughness, vec2 uv ) {

	// TODO: try GGXVNDF implementation from reference [2], here. Needs to update ggxDistribution
	// function below, as well

	// Implementation from reference [1]
	// stretch view
	vec3 V = normalize( vec3( roughness * incidentDir.xy, incidentDir.z ) );

	// orthonormal basis
	vec3 T1 = ( V.z < 0.9999 ) ? normalize( cross( V, vec3( 0.0, 0.0, 1.0 ) ) ) : vec3( 1.0, 0.0, 0.0 );
	vec3 T2 = cross( T1, V );

	// sample point with polar coordinates (r, phi)
	float a = 1.0 / ( 1.0 + V.z );
	float r = sqrt( uv.x );
	float phi = ( uv.y < a ) ? uv.y / a * PI : PI + ( uv.y - a ) / ( 1.0 - a ) * PI;
	float P1 = r * cos( phi );
	float P2 = r * sin( phi ) * ( ( uv.y < a ) ? 1.0 : V.z );

	// compute normal
	vec3 N = P1 * T1 + P2 * T2 + V * sqrt( max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) );

	// unstretch
	N = normalize( vec3( roughness * N.xy, max( 0.0, N.z ) ) );

	return N;

}

// Below are PDF and related functions for use in a Monte Carlo path tracer
// as specified in Appendix B of the following paper
// See equation (34) from reference [0]
float ggxLamda( float theta, float roughness ) {

	float tanTheta = tan( theta );
	float tanTheta2 = tanTheta * tanTheta;
	float alpha2 = roughness * roughness;

	float numerator = - 1.0 + sqrt( 1.0 + alpha2 * tanTheta2 );
	return numerator / 2.0;

}

// See equation (34) from reference [0]
float ggxShadowMaskG1( float theta, float roughness ) {

	return 1.0 / ( 1.0 + ggxLamda( theta, roughness ) );

}

// See equation (125) from reference [4]
float ggxShadowMaskG2( vec3 wi, vec3 wo, float roughness ) {

	float incidentTheta = acos( wi.z );
	float scatterTheta = acos( wo.z );
	return 1.0 / ( 1.0 + ggxLamda( incidentTheta, roughness ) + ggxLamda( scatterTheta, roughness ) );

}

// See equation (33) from reference [0]
float ggxDistribution( vec3 halfVector, float roughness ) {

	float a2 = roughness * roughness;
	a2 = max( EPSILON, a2 );
	float cosTheta = halfVector.z;
	float cosTheta4 = pow( cosTheta, 4.0 );

	if ( cosTheta == 0.0 ) return 0.0;

	float theta = acosSafe( halfVector.z );
	float tanTheta = tan( theta );
	float tanTheta2 = pow( tanTheta, 2.0 );

	float denom = PI * cosTheta4 * pow( a2 + tanTheta2, 2.0 );
	return ( a2 / denom );

}

// See equation (3) from reference [2]
float ggxPDF( vec3 wi, vec3 halfVector, float roughness ) {

	float incidentTheta = acos( wi.z );
	float D = ggxDistribution( halfVector, roughness );
	float G1 = ggxShadowMaskG1( incidentTheta, roughness );

	return D * G1 * max( 0.0, dot( wi, halfVector ) ) / wi.z;

}

// https://github.com/AcademySoftwareFoundation/MaterialX/blob/main/libraries/pbrlib/genglsl/lib/mx_microfacet_specular.glsl#L113
// Rational quadratic fit to Monte Carlo data for GGX directional albedo.
vec3 ggxDirAlbedoAnalytic( float NdotV, float alpha, vec3 F0, vec3 F90 ) {

	float x = NdotV;
    float y = alpha;
    float x2 = x * x;
    float y2 = y * y;
    vec4 r =
		vec4( 0.1003, 0.9345, 1.0, 1.0 ) +
		vec4( - 0.6303, - 2.323, - 1.765, 0.2281 ) * x +
		vec4( 9.748, 2.229, 8.263, 15.94 ) * y +
		vec4( - 2.038, - 3.748, 11.53, - 55.83 ) * x * y +
		vec4( 29.34, 1.424, 28.96, 13.08 ) * x2 +
		vec4( - 8.245, - 0.7684, - 7.507, 41.26 ) * y2 +
		vec4( - 26.44, 1.436, - 36.11, 54.9 ) * x2 * y +
		vec4( 19.99, 0.2913, 15.86, 300.2 ) * x * y2 +
		vec4( - 5.448, 0.6286, 33.37, -285.1 ) * x2 * y2;
    vec2 AB = clamp( r.xy / r.zw, 0.0, 1.0 );
    return F0 * AB.x + F90 * AB.y;

}

vec3 ggxEnergyCompensation( float NdotV, float alpha, vec3 Fss ) {

	float Ess = ggxDirAlbedoAnalytic( NdotV, alpha, vec3( 1.0 ), vec3( 1.0 ) ).r;
    return 1.0 + Fss * ( 1.0 - Ess ) / Ess;

}
`;
