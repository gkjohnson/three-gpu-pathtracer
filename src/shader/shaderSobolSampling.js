// References
// - https://jcgt.org/published/0009/04/01/
// - Code from https://www.shadertoy.com/view/WtGyDm
export const shaderSobolCommon = /* glsl */`

	// Utils
	const float SOBOL_FACTOR = 1.0 / 16777216.0;

	uint reverse_bits( uint x ) {

		x = ( ( ( x & 0xaaaaaaaau ) >> 1 ) | ( ( x & 0x55555555u ) << 1 ) );
		x = ( ( ( x & 0xccccccccu ) >> 2 ) | ( ( x & 0x33333333u ) << 2 ) );
		x = ( ( ( x & 0xf0f0f0f0u ) >> 4 ) | ( ( x & 0x0f0f0f0fu ) << 4 ) );
		x = ( ( ( x & 0xff00ff00u ) >> 8 ) | ( ( x & 0x00ff00ffu ) << 8 ) );
		return ( ( x >> 16 ) | ( x << 16 ) );

	}

	uint hash_combine( uint seed, uint v ) {

		return seed ^ ( v + ( seed << 6 ) + ( seed >> 2 ) );

	}

	uint hash( uint x ) {

		// finalizer from murmurhash3
		x ^= x >> 16;
		x *= 0x85ebca6bu;
		x ^= x >> 13;
		x *= 0xc2b2ae35u;
		x ^= x >> 16;
		return x;

	}

	uint laine_karras_permutation( uint x, uint seed ) {

		x += seed;
		x ^= x * 0x6c50b47cu;
		x ^= x * 0xb82f1e52u;
		x ^= x * 0xc7afe638u;
		x ^= x * 0x8d22f6e6u;
		return x;

	}

	uint nested_uniform_scramble_base2( uint x, uint seed ) {

		x = laine_karras_permutation( x, seed );
		x = reverse_bits( x );
		return x;

	}

`;

export const shaderSobolGeneration = /* glsl */`

	const uint SOBOL_DIRECTIONS1[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u,
		0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
		0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u,
		0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
		0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u,
		0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
		0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u,
		0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu
	);

	const uint SOBOL_DIRECTIONS2[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0x60000000u, 0x90000000u,
		0xe8000000u, 0x5c000000u, 0x8e000000u, 0xc5000000u,
		0x68800000u, 0x9cc00000u, 0xee600000u, 0x55900000u,
		0x80680000u, 0xc09c0000u, 0x60ee0000u, 0x90550000u,
		0xe8808000u, 0x5cc0c000u, 0x8e606000u, 0xc5909000u,
		0x6868e800u, 0x9c9c5c00u, 0xeeee8e00u, 0x5555c500u,
		0x8000e880u, 0xc0005cc0u, 0x60008e60u, 0x9000c590u,
		0xe8006868u, 0x5c009c9cu, 0x8e00eeeeu, 0xc5005555u
	);

	const uint SOBOL_DIRECTIONS3[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0x20000000u, 0x50000000u,
		0xf8000000u, 0x74000000u, 0xa2000000u, 0x93000000u,
		0xd8800000u, 0x25400000u, 0x59e00000u, 0xe6d00000u,
		0x78080000u, 0xb40c0000u, 0x82020000u, 0xc3050000u,
		0x208f8000u, 0x51474000u, 0xfbea2000u, 0x75d93000u,
		0xa0858800u, 0x914e5400u, 0xdbe79e00u, 0x25db6d00u,
		0x58800080u, 0xe54000c0u, 0x79e00020u, 0xb6d00050u,
		0x800800f8u, 0xc00c0074u, 0x200200a2u, 0x50050093u
	);

	const uint SOBOL_DIRECTIONS4[ 32 ] = uint[ 32 ](
		0x80000000u, 0x40000000u, 0x20000000u, 0xb0000000u,
		0xf8000000u, 0xdc000000u, 0x7a000000u, 0x9d000000u,
		0x5a800000u, 0x2fc00000u, 0xa1600000u, 0xf0b00000u,
		0xda880000u, 0x6fc40000u, 0x81620000u, 0x40bb0000u,
		0x22878000u, 0xb3c9c000u, 0xfb65a000u, 0xddb2d000u,
		0x78022800u, 0x9c0b3c00u, 0x5a0fb600u, 0x2d0ddb00u,
		0xa2878080u, 0xf3c9c040u, 0xdb65a020u, 0x6db2d0b0u,
		0x800228f8u, 0x400b3cdcu, 0x200fb67au, 0xb00ddb9du
	);

	uint sobolHash( uint index, uint directions[ 32 ] ) {

		uint X = 0u;
		for ( int bit = 0; bit < 32; bit ++ ) {

			uint mask = ( index >> bit ) & 1u;
			X ^= mask * directions[ bit ];

		}
		return X;

	}

	vec4 generateSobolPoint( uint index ) {

		if ( int( index ) > num_points ) return vec4( 0.0 );

		// uint x = index & 0x00ffffffu;
		uint x = reverse_bits( sobolHash( index, SOBOL_DIRECTIONS1 ) ) & 0x00ffffffu;
		uint y = reverse_bits( sobolHash( index, SOBOL_DIRECTIONS2 ) ) & 0x00ffffffu;
		uint z = reverse_bits( sobolHash( index, SOBOL_DIRECTIONS3 ) ) & 0x00ffffffu;
		uint w = reverse_bits( sobolHash( index, SOBOL_DIRECTIONS4 ) ) & 0x00ffffffu;

		return vec4( x, y, z, w ) * SOBOL_FACTOR;

	}

`;

export const shaderSobolSampling = /* glsl */`

	// Seeds
	uint pixel_idx;
	uint path_idx;

	uint get_seed( uint bounce, uint effect ) {

		return hash(
			hash_combine(
				hash_combine(
					hash( bounce ),
					pixel_idx
				),
				effect
			)
		);

	}

	// Sampling
	const uint SOBOL_DIRECTIONS[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u,
		0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
		0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u,
		0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
		0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u,
		0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
		0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u,
		0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu
	);

	uint sobol( uint index ) {

		uint X = 0u;
		for ( int bit = 0; bit < 32; bit ++ ) {

			uint mask = ( index >> bit ) & 1u;
			X ^= mask * SOBOL_DIRECTIONS[ bit ];

		}
		return X;

	}

	vec2 get_sobol_pt( uint index ) {

		uint x = index & 0x00ffffffu;
    	uint y = reverse_bits( sobol( index ) ) & 0x00ffffffu;

		float r = float( x ) * SOBOL_FACTOR;
		float g = float( y ) * SOBOL_FACTOR;
		return vec2( r, g );

	}

	vec2 get_shuffled_scrambled_sobol_pt( uint index, uint seed ) {

		uint shuffle_seed = hash_combine( seed, 0u );
		uint x_seed = hash_combine( seed, 1u );
		uint y_seed = hash_combine( seed, 2u );

		// TODO: modulus is required if we pre compute a limited number of points
		uint shuffled_index = nested_uniform_scramble_base2( reverse_bits( index ), shuffle_seed );
		// shuffled_index = shuffled_index % uint(num_points);

		vec2 sobol_pt = get_sobol_pt( shuffled_index );
		uint x = uint( sobol_pt.x * 16777216.0 );
		uint y = uint( sobol_pt.y * 16777216.0 );
		x = nested_uniform_scramble_base2( x, x_seed );
		y = nested_uniform_scramble_base2( y, y_seed );
		return vec2( float( x >> 8 ) * SOBOL_FACTOR, float( y >> 8 ) * SOBOL_FACTOR );

	}

	vec2 get_pt( int bounce, int effect ) {

		uint seed = get_seed( uint( bounce ), uint( effect ) );
		return get_shuffled_scrambled_sobol_pt( path_idx, seed );

	}

`;
