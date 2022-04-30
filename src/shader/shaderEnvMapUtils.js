export const shaderEnvMapUtils = /* glsl */`

vec2 equirectUvFromDirection( vec3 direction ) {

    vec2 uv = vec2( atan( direction.z, direction.x ), asin( direction.y ) );
    uv /= vec2( 2.0 * PI, PI );
    uv += 0.5;
    return uv;
    
}

`;
