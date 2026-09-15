export * from './WebGPUPathTracer.js';
export * from './BlurredEnvMapGenerator.js';
export * from './constants.js';
export * from './materials/RenderToScreenMaterial.js';
export * from './denoise/OIDNDenoiser.js';
export * from './upscale/FSRUpscaler.js';

// extend the cameras to avoid adding WebGPU imports to the WebGLPathTracer
import './shims/EquirectCameraShim.js';
import './shims/PhysicalCameraShim.js';
import './shims/ArrayCameraShim.js';
