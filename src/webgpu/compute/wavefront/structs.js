import { StructTypeNode } from 'three/webgpu';

export const queuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	_alignment0: 'uint',

	direction: 'vec3f',
	_alignment1: 'uint',

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	pixel: 'vec2u',

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

	resultColor: 'vec4f',

}, 'QueuedHit' );

export const queueSizesStructFree = new StructTypeNode( {

	rayQueueStart: 'uint',
	rayQueueEnd: 'uint',

	hitQueueStart: 'uint',
	hitQueueEnd: 'uint',

} );

export const queueSizesStructRayFree = new StructTypeNode( {

	rayQueueStart: 'uint',
	rayQueueEnd: 'uint',

	hitQueueStart: { type: 'uint', atomic: true },
	hitQueueEnd: { type: 'uint', atomic: true },

} );

export const queueSizesStructHitFree = new StructTypeNode( {

	rayQueueStart: { type: 'uint', atomic: true },
	rayQueueEnd: { type: 'uint', atomic: true },

	hitQueueStart: 'uint',
	hitQueueEnd: 'uint',

} );
