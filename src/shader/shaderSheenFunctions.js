export const shaderSheenFunctions = /* glsl */`

// See equation (2) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
float velvetD( float cosThetaH, float roughness ) {

	float alpha = max( roughness, 0.07 );
	alpha = alpha * alpha;

	float invAlpha = 1.0 / alpha;

	float sqrCosThetaH = cosThetaH * cosThetaH;
	float sinThetaH = max( 1.0 - sqrCosThetaH, 0.001 );

	return ( 2.0 + invAlpha ) * pow( sinThetaH, 0.5 * invAlpha ) / ( 2.0 * PI );

}

float velvetParamsInterpolate( int i, float oneMinusAlphaSquared ) {

	const float p0[5] = float[5]( 25.3245, 3.32435, 0.16801, -1.27393, -4.85967 );
	const float p1[5] = float[5]( 21.5473, 3.82987, 0.19823, -1.97760, -4.32054 );

	return mix( p1[i], p0[i], oneMinusAlphaSquared );

}

float velvetL( float x, float alpha ) {

	float oneMinusAlpha = 1.0 - alpha;
	float oneMinusAlphaSquared = oneMinusAlpha * oneMinusAlpha;

	float a = velvetParamsInterpolate( 0, oneMinusAlphaSquared );
	float b = velvetParamsInterpolate( 1, oneMinusAlphaSquared );
	float c = velvetParamsInterpolate( 2, oneMinusAlphaSquared );
	float d = velvetParamsInterpolate( 3, oneMinusAlphaSquared );
	float e = velvetParamsInterpolate( 4, oneMinusAlphaSquared );

	return a / ( 1.0 + b * pow( abs( x ), c ) ) + d * x + e;

}

// See equation (3) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
float velvetLambda( float cosTheta, float alpha ) {

	return abs( cosTheta ) < 0.5 ? exp( velvetL( cosTheta, alpha ) ) : exp( 2.0 * velvetL( 0.5, alpha ) - velvetL( 1.0 - cosTheta, alpha ) );

}

// See Section 3, Shadowing Term, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
float velvetG( float cosThetaO, float cosThetaI, float roughness ) {

	float alpha = max( roughness, 0.07 );
	alpha = alpha * alpha;

	return 1.0 / ( 1.0 + velvetLambda( cosThetaO, alpha ) + velvetLambda( cosThetaI, alpha ) );

}

float directionalAlbedoSheen( float cosTheta, float alpha ) {

	cosTheta = saturate( cosTheta );

	float c = 1.0 - cosTheta;
	float c3 = c * c * c;

	return 0.65584461 * c3 + 1.0 / ( 4.16526551 + exp( -7.97291361 * sqrt( alpha ) + 6.33516894 ) );

}

float sheenAlbedoScaling( vec3 wo, vec3 wi, SurfaceRec surf ) {

	float alpha = max( surf.sheenRoughness, 0.07 );
	alpha = alpha * alpha;

	float maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

	float eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );
	float eWi = directionalAlbedoSheen( saturateCos( wi.z ), alpha );

	return min( 1.0 - maxSheenColor * eWo, 1.0 - maxSheenColor * eWi );

}

// See Section 5, Layering, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
float sheenAlbedoScaling( vec3 wo, SurfaceRec surf ) {

	float alpha = max( surf.sheenRoughness, 0.07 );
	alpha = alpha * alpha;

	float maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

	float eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );

	return 1.0 - maxSheenColor * eWo;

}

`;
