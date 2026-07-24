import { StructTypeNode } from 'three/webgpu';

export const queuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	seed: 'uint',

	direction: 'vec3f',
	_alignment0: 'uint',

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	pixel: 'vec2u',
	bsdfPdf: 'float', // pdf of the scatter that produced this ray, for escape-to-env MIS
	_alignment1: 'uint',

	resultColor: 'vec4f',

}, 'QueuedRay' );

export const queuedHitStruct = new StructTypeNode( {

	indices: 'vec3u',
	seed: 'uint',

	barycoord: 'vec2f',
	pixel_x: 'uint',
	pixel_y: 'uint',

	view: 'vec3f',
	currentBounce: 'uint',

	throughputColor: 'vec3f',
	objectIndex: 'uint',

	normal: 'vec3f',
	side: 'float',

	resultColor: 'vec4f',

}, 'QueuedHit' );
