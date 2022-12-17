export const shaderSobolSampling = /* glsl */`

// References
// - https://jcgt.org/published/0009/04/01/
// - Code from https://www.shadertoy.com/view/WtGyDm

const float SOBOL_FACTOR = 1.0 / 16777216.0;
const uint SOBOL_DIRECTIONS[32] = uint[32](
	0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u,
	0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
	0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u,
	0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
	0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u,
	0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
	0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u,
	0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu
);

uint reverse_bits(uint x) {
	x = (((x & 0xaaaaaaaau) >> 1) | ((x & 0x55555555u) << 1));
	x = (((x & 0xccccccccu) >> 2) | ((x & 0x33333333u) << 2));
	x = (((x & 0xf0f0f0f0u) >> 4) | ((x & 0x0f0f0f0fu) << 4));
	x = (((x & 0xff00ff00u) >> 8) | ((x & 0x00ff00ffu) << 8));
	return ((x >> 16) | (x << 16));
}

uint hash_combine(uint seed, uint v) {
	return seed ^ (v + (seed << 6) + (seed >> 2));
}

uint hash(uint x) {
	// finalizer from murmurhash3
	x ^= x >> 16;
	x *= 0x85ebca6bu;
	x ^= x >> 13;
	x *= 0xc2b2ae35u;
	x ^= x >> 16;
	return x;
}

uint laine_karras_permutation(uint x, uint seed) {
	x += seed;
	x ^= x * 0x6c50b47cu;
	x ^= x * 0xb82f1e52u;
	x ^= x * 0xc7afe638u;
	x ^= x * 0x8d22f6e6u;
	return x;
}

uint nested_uniform_scramble_base2(uint x, uint seed) {
	x = laine_karras_permutation(x, seed);
	x = reverse_bits(x);
	return x;
}

uint sobol(uint index) {
	uint X = 0u;
	for (int bit = 0; bit < 32; bit++) {
		uint mask = (index >> bit) & 1u;
		X ^= mask * SOBOL_DIRECTIONS[bit];
	}
	return X;
}

vec2 get_sobol_pt(uint index) {
	uint x = reverse_bits(index) >> 8;
	uint y = sobol(index) >> 8;

	float r = float(x) * SOBOL_FACTOR;
	float g = float(y) * SOBOL_FACTOR;
	return vec2( r, g );
}

uint pixel_idx;
uint path_idx;

uint get_seed(uint bounce, uint effect) {
	return hash(
		hash_combine(
			hash_combine(
				hash(bounce),
				pixel_idx
			),
			effect
		)
	);
}

vec2 get_shuffled_scrambled_sobol_pt(uint index, uint seed) {
	uint shuffle_seed = hash_combine(seed, 0u);
	uint x_seed = hash_combine(seed, 1u);
	uint y_seed = hash_combine(seed, 2u);

	// TODO: modulus is required if we pre compute a limited number of points
	uint shuffled_index = nested_uniform_scramble_base2(reverse_bits(index), shuffle_seed);
	// shuffled_index = shuffled_index % uint(num_points);

	vec2 sobol_pt = get_sobol_pt(shuffled_index);
	uint x = uint(sobol_pt.x * 16777216.0);
	uint y = uint(sobol_pt.y * 16777216.0);
	x = nested_uniform_scramble_base2(x, x_seed);
	y = nested_uniform_scramble_base2(y, y_seed);
	return vec2(float(x >> 8) * SOBOL_FACTOR, float(y >> 8) * SOBOL_FACTOR);
}

vec2 get_pt(int bounce, int effect) {
	return get_shuffled_scrambled_sobol_pt(
		uint(path_idx),
		get_seed(uint(bounce), uint(effect)));
}












`;