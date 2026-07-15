// Alpha test should be the last index as it is summed with triangle index
export const RNG_INDEX_RAY_JITTER = 0;
export const RNG_INDEX_ENVIRONMENT_SAMPLE = 1;
export const RNG_INDEX_SCATTER_TYPE = 2;
export const RNG_INDEX_SCATTER_DIRECTION = 3;
export const RNG_INDEX_APERTURE_SAMPLE = 4;
export const RNG_INDEX_ALPHA_TEST = 50;

// Re-exports used to adjust the random-sampling strategy to use

// export * from './rand/pcg.wgsl.js';
// export * from './rand/sobol.wgsl.js';
export * from './rand/bluedither.wgsl.js';
