export const stratifiedTextureGLSL = /* glsl */`

	uniform sampler2D stratifiedTexture;
	uniform sampler2D stratifiedOffsetTexture;

	uint sobolPixelIndex = 0u;
	uint sobolPathIndex = 0u;
	uint sobolBounceIndex = 0u;
	float pixelSeed = 0.0;
	uvec4 WHITE_NOISE_SEED;

	vec4 sobol4( int v ) {

		vec4 stratifiedSample = texelFetch( stratifiedTexture, ivec2( v, sobolBounceIndex ), 0 );
		vec4 random = fract( stratifiedSample + pixelSeed ); // blue noise + stratified samples

		// transform random number between [0, 1] to (0, 1)
		// TODO: is this needed?
		float EPS = 0.0005;
		return vec4( EPS ) + ( 1.0 - 2.0 * EPS ) * random;

	}

	vec3 sobol3( int v ) {

		return sobol4( v ).xyz;

	}

	vec2 sobol2( int v ) {

		return sobol4( v ).xy;

	}

	float sobol( int v ) {

		return sobol4( v ).x;

	}

	void rng_initialize( vec2 screenCoord, int frame ) {

		vec2 noiseSize = vec2( textureSize( stratifiedOffsetTexture, 0 ) );

		// tile the small noise texture across the entire screen
		pixelSeed = texture( stratifiedOffsetTexture, screenCoord / noiseSize ).r;

		WHITE_NOISE_SEED = uvec4( screenCoord, uint( frame ), uint( screenCoord.x ) + uint( screenCoord.y ) );

	}

	// TODO: remove pcg functions here
	void pcg4d( inout uvec4 v ) {

		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.w;
		v.y += v.z * v.x;
		v.z += v.x * v.y;
		v.w += v.y * v.z;
		v = v ^ ( v >> 16u );
		v.x += v.y*v.w;
		v.y += v.z*v.x;
		v.z += v.x*v.y;
		v.w += v.y*v.z;

	}

	// returns [ 0, 1 ]
	float rand() {

		pcg4d( WHITE_NOISE_SEED );
		return float( WHITE_NOISE_SEED.x ) / float( 0xffffffffu );

	}

`;
