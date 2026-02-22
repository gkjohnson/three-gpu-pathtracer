import { wgsl } from 'three/tsl';
import { rayStruct } from '../../lib/wgsl/structs.wgsl.js';

export const QUEUED_RAY_SIZE = 16;

export const QUEUED_HIT_SIZE = 16;

export const queuedRayStruct = wgsl( /* wgsl */ `
	struct QueuedRay {
		ray: Ray,
		throughputColor: vec3f,
		currentBounce: u32,
		pixel: vec2u,
	};
`, [ rayStruct ] );

export const queuedHitStruct = wgsl( /* wgsl */`
	struct QueuedHit {
		indices: vec3u,
		pixel_x: u32,
		barycoord: vec3f,
		pixel_y: u32,
		view: vec3f,
		currentBounce: u32,
		throughputColor: vec3f,
		objectIndex: u32,
	};
` );
