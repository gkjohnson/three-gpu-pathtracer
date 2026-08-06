import { wgsl } from 'three/tsl';
import { StructTypeNode } from 'three/webgpu';
import { WGSLStructTypeNode } from '../../WGSLStructTypeNode.js';

export const queuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	seed: 'uint',

	direction: 'vec3f',
	_alignment0: 'uint',

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	pixel: 'vec2u',

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

// Queue wrapper structs: the read ( start ) and write ( end ) cursors live in a header on the queue's
// own storage buffer, ahead of the runtime-sized element array. This replaces the separate queueSizes
// buffer. Each queue has a plain and an atomic variant ( same buffer, reinterpreted per kernel ): the
// atomic variant is bound where cursors are advanced with atomicAdd, the plain one where they are only
// read or reset.
export const rayQueueStruct = new WGSLStructTypeNode( 'RayQueue', wgsl( /* wgsl */`

	struct RayQueue {
		start: u32,
		end: u32,

		elements: array< ${ queuedRayStruct.name } >,
	}

`, [ queuedRayStruct ] ) );

export const rayQueueAtomicStruct = new WGSLStructTypeNode( 'RayQueue', wgsl( /* wgsl */`

	struct RayQueue {
		start: atomic< u32 >,
		end: atomic< u32 >,

		elements: array< ${ queuedRayStruct.name } >,
	}

`, [ queuedRayStruct ] ) );

export const hitQueueStruct = new WGSLStructTypeNode( 'HitQueue', wgsl( /* wgsl */`

	struct HitQueue {
		start: u32,
		end: u32,
		_padding: array< u32, 2 >,

		elements: array< ${ queuedHitStruct.name } >,
	}

`, [ queuedHitStruct ] ) );

export const hitQueueAtomicStruct = new WGSLStructTypeNode( 'HitQueue', wgsl( /* wgsl */`

	struct HitQueue {
		start: atomic< u32 >,
		end: atomic< u32 >,
		_padding: array< u32, 2 >,

		elements: array< ${ queuedHitStruct.name } >,
	}

`, [ queuedHitStruct ] ) );
