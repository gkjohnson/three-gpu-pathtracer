import { StructTypeNode } from 'three/webgpu';

export const queuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	_alignment0: 'uint',

	direction: 'vec3f',
	_alignment1: 'uint',

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	pixel: 'vec2u',

	pcgStateS0: 'vec4u',

	resultColor: 'vec4f',

}, 'QueuedRay' );

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

	pcgStateS0: 'vec4u',

	resultColor: 'vec4f',

}, 'QueuedHit' );
