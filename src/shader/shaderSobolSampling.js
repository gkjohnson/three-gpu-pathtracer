export const shaderSobolSampling = /* glsl */`

// References
// - https://jcgt.org/published/0009/04/01/
// - Code from https://www.shadertoy.com/view/WtGyDm

/*
 * This first buffer simply computes and store elements of the Sobol (0,2)
 * sequence. This is a useful optimization for a ray tracer, because it
 * avoids having to recompute these values for every sample, although it
 * does cost a texture read.
 *
 * Code is mostly taken and adapted from the supplementary material
 * for Practical Hash-Based Owen Scrambling (Burley, 2020):
 *     http://www.jcgt.org/published/0009/04/01/
 */

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

uint sobol(uint index) {
      uint X = 0u;
      for (int bit = 0; bit < 32; bit++) {
        uint mask = (index >> bit) & 1u;
        X ^= mask * SOBOL_DIRECTIONS[bit];
      }
      return X;
}

vec2 sobolPoint(uint index) {
	uint x = reverse_bits(index) >> 8;
    uint y = sobol(index) >> 8;

    float r = float(x) * SOBOL_FACTOR;
    float g = float(y) * SOBOL_FACTOR;
	return vec2( r, g );
}




/*
 * Forked from https://www.shadertoy.com/view/4lfcDr. Adapted to use Owen
 * scrambled and shuffled Sobol (0,2) sequences.
 */

uint pixel_idx;
uint path_idx;


vec2 get_sobol_pt(uint index) {
  uint y = index / uint(iChannelResolution[0].x);
  uint x = index - (y * uint(iChannelResolution[0].x));
  vec2 uv = vec2(x, y) / iChannelResolution[0].xy;
  return texture(iChannel0, uv).rg;
}

uint get_seed(uint bounce, uint effect) {
    return hash(hash_combine(hash_combine(hash(bounce), pixel_idx), effect));
}

vec2 get_shuffled_scrambled_sobol_pt(uint index, uint seed) {
  uint shuffle_seed = hash_combine(seed, 0u);
  uint x_seed = hash_combine(seed, 1u);
  uint y_seed = hash_combine(seed, 2u);

  uint shuffled_index =
      nested_uniform_scramble_base2(reverse_bits(index), shuffle_seed)
      % uint(num_points);

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
