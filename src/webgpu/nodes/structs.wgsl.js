import { wgsl } from 'three/tsl';
import { rayStruct } from 'three-mesh-bvh/webgpu';

export const constants = wgsl( /* wgsl */ `
		const PI: f32 = 3.141592653589793;
` );

export const scatterRecordStruct = wgsl( /* wgsl */ `
	struct ScatterRecord {
		direction: vec3f,
		pdf: f32, // Actually just a probability
		value: f32,
	};
` );

export const materialStruct = wgsl( /* wgsl */`
	struct Material {
		albedo: vec3f,
		// roughness: f32,
		// metalness: f32,
	};
` );

export const surfaceRecordStruct = wgsl( /* wgsl */`
	struct SurfaceRecord {
		normal: vec3f,
		albedo: vec3f,

		roughness: f32,
		metalness: f32,
	};
` );

// TODO: write a proposal for a storage-backed structs and arrays in structs for three.js
//
// const hitResultQueueStruct = wgsl( /* wgsl */ `
// 	struct HitResultQueue {
// 		currentSize: atomic<u32>,
// 		queue: array<HitResultQueueElement>,
// 	};
// `, [ hitResultQueueElementStruct ] );

export const rayQueueElementStruct = wgsl( /* wgsl */ `

	struct RayQueueElement {
		ray: Ray,
		throughputColor: vec3f,
		currentBounce: u32,
		pixel: vec2u,
	};

`, [ rayStruct ] );

export const hitResultQueueElementStruct = wgsl( /* wgsl */`
	struct HitResultQueueElement {
		normal: vec3f,
		pixel_x: u32,
		position: vec3f,
		pixel_y: u32,
		view: vec3f,
		currentBounce: u32,
		throughputColor: vec3f,
		vertexIndex: u32,
	};
` );

