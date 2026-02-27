import { rayStruct } from '../../lib/wgsl/structs.wgsl.js';
import { StructTypeNode } from 'three/webgpu';

// TODO: when possible this should be changed to pass the "rayStruct"
// in as a type so dependencies are carried
export const queuedRayStruct = new StructTypeNode( {
	ray: 'Ray',
	throughputColor: 'vec3f',
	currentBounce: 'u32',
	pixel: 'vec2u',
}, 'QueuedRay' );
queuedRayStruct.getLength = () => rayStruct.getLength() + 8;

export const queuedHitStruct = new StructTypeNode( {
	indices: 'vec3u',
	pixel_x: 'uint',
	barycoord: 'vec3f',
	pixel_y: 'uint',
	view: 'vec3f',
	currentBounce: 'uint',
	throughputColor: 'vec3f',
	objectIndex: 'uint',
	normal: 'vec3f',
	side: 'float',
}, 'QueuedHit' );
