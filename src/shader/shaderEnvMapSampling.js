export const shaderEnvMapSampling = /* glsl */`

vec2 equirectUvFromDirection( vec3 direction ) {

    vec2 uv = vec2( atan( direction.z, direction.x ), asin( direction.y ) );
    uv /= vec2( 2.0 * PI, PI );
    uv += 0.5;
    return uv;
    
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

`;
