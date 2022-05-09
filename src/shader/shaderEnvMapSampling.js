export const shaderEnvMapSampling = /* glsl */`

vec3 sampleEquirectEnvMapColor( vec3 direction, sampler2D map, float lodBias ) {

	return texture2D( map, equirectDirectionToUv( direction ), lodBias ).rgb;

}

float envMapDirectionPdf( vec3 direction ) {

	vec2 uv = equirectDirectionToUv( direction );
	float theta = uv.y * PI;
	float sinTheta = sin( theta );
	if ( sinTheta == 0.0 ) {
		
		return 0.0;

	}

	return 1.0 / ( 2.0 * PI * PI * sinTheta );

}

float envMapSample( vec3 direction, EquirectHdrInfo info, float mipBlur, out vec3 color ) {

	vec2 uv = equirectDirectionToUv( direction );
	color = texture2D( info.map, uv, mipBlur * info.maxMip ).rgb;

	float lum = colorToLuminance( color );
	ivec2 resolution = textureSize( info.map, 0 );
	float pdf = lum / info.totalSum;

	return float( resolution.x * resolution.y ) * pdf * envMapDirectionPdf( direction );

}

float randomEnvMapSample( EquirectHdrInfo info, float mipBlur, out vec3 color, out vec3 direction ) {

	// sample env map cdf
	vec2 r = rand2();
	float v = texture2D( info.marginalWeights, vec2( r.x, 0.0 ) ).x;
	float u = texture2D( info.conditionalWeights, vec2( r.y, v ) ).x;
	vec2 uv = vec2( u, v );

	vec3 derivedDirection = equirectUvToDirection( uv );
	direction = derivedDirection;
	color = texture2D( info.map, uv, mipBlur * info.maxMip ).rgb;

	float lum = colorToLuminance( color );
	ivec2 resolution = textureSize( info.map, 0 );
	float pdf = lum / info.totalSum;

	return float( resolution.x * resolution.y ) * pdf * envMapDirectionPdf( direction );

}

float misHeuristic( float a, float b ) { 

	float aa = a * a;
	float bb = a * b;
	return aa / ( bb + aa );

}

`;
