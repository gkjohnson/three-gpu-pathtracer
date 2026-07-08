import { StructTypeNode } from 'three/webgpu';
import { WGSLStructTypeNode } from '../../WGSLStructTypeNode';
import { wgsl } from 'three/tsl';

export const rayDataStruct = new StructTypeNode( {

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	resultColor: 'vec4f',

	attenuation: 'vec3f',
	shadowRayIntersectionIndex: 'int',

	emission: 'vec3f',
	rayIntersectionIndex: 'int',

	lightDirection: 'vec3f',
	lightPdf: 'float',

	lightBsdf: 'vec3f',
	pixelIndex: 'uint',

	lightEmission: 'vec3f',
	lightBsdfPdf: 'float',

	bsdf: 'vec3f',
	pdf: 'float',

	indices: 'vec3u',
	objectIndex: 'int',

	barycoord: 'vec3f',
	minPdf: 'float',

	direction: 'vec3f',
	dist: 'float',

}, 'RayData' );

export const intersectionResultStruct = new StructTypeNode( {

	indices: 'vec3u',
	objectIndex: 'int',

	barycoord: 'vec3f',
	dist: 'float',

	position: 'vec3f',

} );

export const traceQueuedRayStruct = new StructTypeNode( {
	origin: 'vec3f',
	pixelIndex: 'uint',
	direction: 'vec3f',
	currentBounce: 'uint',
}, 'TraceQueuedRay' );

export const rayQueueStruct = new WGSLStructTypeNode( 'RayQueue', wgsl( /* wgsl */`

	struct RayQueue {

		length: atomic< u32 >,
		elements: array< ${ traceQueuedRayStruct.name } >,

	}

`, [ traceQueuedRayStruct ] ) );

export const pixelQueueStruct = new WGSLStructTypeNode( 'PixelQueue', wgsl( /* wgsl */ `

	struct PixelQueue {

		current: atomic< u32 >,
		elementCount: u32,
		elements: array< atomic< u32 > >,

	}

` ) );

export const pixelQueueNonAtomicStruct = new WGSLStructTypeNode( 'PixelQueue', wgsl( /* wgsl */ `

	struct PixelQueue {

		current: atomic< u32 >,
		elementCount: u32,
		elements: array< u32 >,

	}

` ) );
