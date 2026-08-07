// How rays that have only passed through transmissive surfaces treat the background on a miss.
// ENVIRONMENT displays the environment map through the glass and keeps the pixel opaque. OVERLAY
// and TRANSPARENT reduce the pixel alpha by the average transmitted throughput so a transparent
// background composites through the glass, with OVERLAY also adding transmitted environment light
// so the glass keeps a tint matching the rest of the model. OVERLAY and TRANSPARENT only differ
// from each other when the background is transparent.
export const TRANSMISSIVE_BACKGROUND_ENVIRONMENT = 0;
export const TRANSMISSIVE_BACKGROUND_OVERLAY = 1;
export const TRANSMISSIVE_BACKGROUND_TRANSPARENT = 2;
