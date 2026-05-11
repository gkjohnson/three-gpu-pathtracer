import { wgsl } from 'three/tsl';
import { StructTypeNode } from 'three/webgpu';
import { WGSLStructTypeNode } from '../../WGSLStructTypeNode';

export const queuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	pixel: 'uint',

	direction: 'vec3f',
	lastPdf: 'float',

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	resultColor: 'vec3f',
	minPdf: 'float',

}, 'QueuedRay' );

export const queuedHitStruct = new StructTypeNode( {

	indices: 'vec3u',
	pixel: 'uint',

	barycoord: 'vec3f',

	view: 'vec3f',
	currentBounce: 'uint',

	throughputColor: 'vec3f',
	objectIndex: 'uint',

	normal: 'vec3f',
	side: 'float',

	resultColor: 'vec3f',
	minPdf: 'float',

	lightDirection: 'vec3f',
	lightPdf: 'float',

	lightColor: 'vec3f',
	hitDist: 'float',

}, 'QueuedHit' );


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
