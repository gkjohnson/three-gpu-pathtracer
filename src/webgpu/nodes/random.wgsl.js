// Alpha test should be the last index as it is summed with triangle index
export const RNG_INDEX_RAY_JITTER = 0;
export const RNG_INDEX_ENVIRONMENT_SAMPLE = 1;
export const RNG_INDEX_SCATTER_TYPE = 2;
export const RNG_INDEX_SCATTER_DIRECTION = 3;
export const RNG_INDEX_APERTURE_SAMPLE = 4;
export const RNG_INDEX_DIRECT_LIGHT_SAMPLE = 5;
export const RNG_INDEX_ALPHA_TEST = 50;
import { contextProxyFn } from 'three-mesh-bvh/webgpu';
import * as sobol from './rand/sobol.wgsl.js';

// Wrap random functions in context-proxies that will retrieve the functions from
// the build context if present otherwise fallback to sobol.
export const rngInit = contextProxyFn( 'random.rngInit', sobol.rngInit );
export const rngNextBounce = contextProxyFn( 'random.rngNextBounce', sobol.rngNextBounce );
export const rand1 = contextProxyFn( 'random.rand1', sobol.rand1 );
export const rand2 = contextProxyFn( 'random.rand2', sobol.rand2 );
export const rand3 = contextProxyFn( 'random.rand3', sobol.rand3 );
export const rand4 = contextProxyFn( 'random.rand4', sobol.rand4 );
