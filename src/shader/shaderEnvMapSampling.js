export const shaderEnvMapSampling = /* glsl */`

float colorToLuminance( vec3 color ) {

	// https://en.wikipedia.org/wiki/Relative_luminance
	return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

}

// ray sampling x and z are swapped to align with expected background view
vec2 equirectDirectionToUv( vec3 direction ) {

	// from Spherical.setFromCartesianCoords
    vec2 uv = vec2( atan( direction.z, direction.x ), acos( direction.y ) );
    uv /= vec2( 2.0 * PI, PI );

	// apply adjustments to get values in range [0, 1] and y right side up
    uv.x += 0.5;
	uv.y = 1.0 - uv.y;
    return uv;
    
}

vec3 equirectUvToDirection( vec2 uv ) {

	// undo above adjustments
	uv.x -= 0.5;
	uv.y = 1.0 - uv.y;

	// from Vector3.setFromSphericalCoords
	float theta = uv.x * 2.0 * PI;
	float phi = uv.y * PI;

	float sinPhi = sin( phi );

	return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

}

vec3 sampleEquirectEnvMapColor( vec3 direction, sampler2D map ) {

	// TODO: can we ensure that the ray is always normalized?
	return texture2D( map, equirectDirectionToUv( direction ) ).rgb;

}

float envMapDirectionPdf( vec3 direction, ivec2 resolution ) {

	vec2 uv = equirectDirectionToUv( direction );
	float theta = uv.y * PI;
	float sinTheta = sin( theta );
	if ( sinTheta == 0.0 ) {
		
		return 0.0;

	}

	return 2.0 * PI * PI * sinTheta / float( resolution.x * resolution.y );

}

float envMapSample( vec3 direction, EquirectHdrInfo info, out vec3 color ) {

	vec2 uv = equirectDirectionToUv( direction );
	color = texture2D( info.map, uv ).rgb;

	ivec2 resolution = textureSize( info.map, 0 );
	return envMapDirectionPdf( direction, resolution );
	
}

vec2 sampleEnvMapCDF( EquirectHdrInfo info ) {

	vec2 r = rand2();
    float v = texture( info.marginalWeights, vec2( r.x, 0.0 ) ).x;
    float u = texture( info.conditionalWeights, vec2( r.y, v ) ).x;

	return vec2( u, v );

}

float randomEnvMapSample( EquirectHdrInfo info, out vec3 color, out vec3 direction ) {

	vec2 uv = rand2(); // TODO: sample from the cdf
	direction = equirectUvToDirection( uv );
	color = texture2D( info.map, uv ).rgb;

	ivec2 resolution = textureSize( info.map, 0 );
	return envMapDirectionPdf( direction, resolution );

}


`;
