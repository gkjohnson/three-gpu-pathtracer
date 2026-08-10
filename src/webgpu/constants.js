// How rays that have only passed through transmissive surfaces treat the background on a miss

// Sample the env map
export const TRANSMISSIVE_BACKGROUND_ENVIRONMENT = 0;

// Set the opacity based on transmitted light intensity with env lighting tint
export const TRANSMISSIVE_BACKGROUND_OVERLAY = 1;

// Attenuate light based on transmitted
export const TRANSMISSIVE_BACKGROUND_TRANSPARENT = 2;
