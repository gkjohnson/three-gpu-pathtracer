export const shaderEnvMapSampling = /* glsl */`

// ray sampling x and z are swapped to align with expected background view
vec2 equirectUvFromDirection( vec3 direction ) {

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
	return texture2D( map, equirectUvFromDirection( direction ) ).rgb;

}

float envMapDirectionPdf( vec3 direction, vec2 resolution ) {

	vec2 uv = equirectUvFromDirection( direction );
	float theta = uv.y * PI;
	float sinTheta = sin( theta );
	if ( sinTheta == 0.0 ) {
		
		return 0.0;

	}

	return 2.0 * PI * PI * sinTheta / resolution.x * resolution.y;

}

float envMapSample( vec3 direction, EquirectHdrInfo info, out vec3 color ) {

	// TODO

	return 0.0;
	
}

float randomEnvMapSample( EquirectHdrInfo info, out vec3 color, out float direction ) {



	return 0.0;

}


`;
