// How rays that have only passed through transmissive surfaces treat the background on a miss.
// Assign one to "WebGPUPathTracer.transmissiveBackground".

/**
 * Sample the environment map, so glass shows what is behind it.
 * @section Transmissive Background Modes
 * @type {number}
 */
export const TRANSMISSIVE_BACKGROUND_ENVIRONMENT = 0;

/**
 * Set the opacity from the transmitted light intensity, tinted by the environment lighting.
 * @section Transmissive Background Modes
 * @type {number}
 */
export const TRANSMISSIVE_BACKGROUND_OVERLAY = 1;

/**
 * Attenuate the background by the transmitted light, so glass renders against transparency.
 * @section Transmissive Background Modes
 * @type {number}
 */
export const TRANSMISSIVE_BACKGROUND_TRANSPARENT = 2;

// Layout of the r32uint "sample count" target: two flag bits then a 30 bit count.

// this pixel already has a ray on the queue
export const SAMPLE_ACTIVE_FLAG = 0x80000000;

// this pixel has had a camera ray at least once
export const SAMPLE_DISPATCHED_FLAG = 0x40000000;

export const SAMPLE_COUNT_MASK = 0x3FFFFFFF;
