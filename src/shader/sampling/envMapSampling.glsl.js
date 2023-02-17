export const envMapSampling = /* glsl */`

	// samples the the given environment map in the given direction
	// TODO: swap argument order
	vec3 sampleEquirectEnvMapColor( vec3 direction, sampler2D envMap ) {

		return texture2D( envMap, equirectDirectionToUv( direction ) ).rgb;

	}

	// gets the pdf of the given direction to sample
	// TODO: rename equirectDirectionPdf
	float envMapDirectionPdf( vec3 direction ) {

		vec2 uv = equirectDirectionToUv( direction );
		float theta = uv.y * PI;
		float sinTheta = sin( theta );
		if ( sinTheta == 0.0 ) {

			return 0.0;

		}

		return 1.0 / ( 2.0 * PI * PI * sinTheta );

	}

	// samples the color given env map with CDF and returns the pdf of the direction
	// TODO: rename function
	float sampleEnvMap( EquirectHdrInfo info, vec3 direction, out vec3 color ) {

		vec2 uv = equirectDirectionToUv( direction );
		color = texture2D( info.map, uv ).rgb;

		float totalSum = info.totalSumWhole + info.totalSumDecimal;
		float lum = luminance( color );
		ivec2 resolution = textureSize( info.map, 0 );
		float pdf = lum / totalSum;

		return float( resolution.x * resolution.y ) * pdf * envMapDirectionPdf( direction );

	}

	// samples a direction of the envmap with color and retrieves pdf
	float sampleEnvMapProbability( EquirectHdrInfo info, vec2 r, out vec3 color, out vec3 direction ) {

		// sample env map cdf
		float v = texture2D( info.marginalWeights, vec2( r.x, 0.0 ) ).x;
		float u = texture2D( info.conditionalWeights, vec2( r.y, v ) ).x;
		vec2 uv = vec2( u, v );

		vec3 derivedDirection = equirectUvToDirection( uv );
		direction = derivedDirection;
		color = texture2D( info.map, uv ).rgb;

		float totalSum = info.totalSumWhole + info.totalSumDecimal;
		float lum = luminance( color );
		ivec2 resolution = textureSize( info.map, 0 );
		float pdf = lum / totalSum;

		return float( resolution.x * resolution.y ) * pdf * envMapDirectionPdf( direction );

	}

`;
