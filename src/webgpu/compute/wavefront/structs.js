import { StructTypeNode } from 'three/webgpu';

// StructTypeNode that force-emits dependency structs. TSL can't discover a struct referenced only via
// a type string, so we build each dependency first, which registers its definition ahead of this struct.
// TODO: remove this once TSL resolves struct dependencies from string member types itself.
class DependentStructTypeNode extends StructTypeNode {

	constructor( members, name, dependencies = [] ) {

		super( members, name );
		this.dependencies = dependencies;

	}

	setup( builder ) {

		for ( const dep of this.dependencies ) {

			dep.build( builder );

		}

		super.setup( builder );

	}

}

// Persistent per-path-slot state. One slot per in-flight path, holding everything needed to resolve
// the previous frame's trace results and stage the next bounce.
export const rayDataStruct = new StructTypeNode( {

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	resultColor: 'vec4f',

	emission: 'vec3f',
	pdf: 'float',

	bsdf: 'vec3f',
	_alignment0: 'uint',

	origin: 'vec3f',
	_alignment1: 'uint',

	direction: 'vec3f',
	side: 'float',

	normal: 'vec3f',
	objectIndex: 'int',

	barycoord: 'vec3f',
	pixelIndex: 'uint',

	indices: 'vec3u',
	seed: 'uint',

	lightDirection: 'vec3f',
	lightPdf: 'float',

	lightEmission: 'vec3f',
	lightDist: 'float',

	lightBsdf: 'vec3f',
	lightBsdfPdf: 'float',

	rayIntersectionIndex: 'int',
	shadowRayIntersectionIndex: 'int',
	lightType: 'int',
	_alignment2: 'uint',

}, 'RayData' );

// A ray queued for BVH traversal by the trace kernels.
export const traceQueuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	pixelIndex: 'uint',

	direction: 'vec3f',
	currentBounce: 'uint',

	seed: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
	_alignment2: 'uint',

}, 'TraceQueuedRay' );

// Compact trace result, written by the trace kernels at the ray's queue index and consumed by
// LogicKernel the following frame. objectIndex < 0 encodes a miss.
export const intersectionResultStruct = new StructTypeNode( {

	barycoord: 'vec3f',
	objectIndex: 'int',

	position: 'vec3f',
	dist: 'float',

	normal: 'vec3f',
	side: 'float',

	indices: 'vec3u',
	_alignment0: 'uint',

}, 'TraceResult' );

// Queue wrappers that keep an append-only length counter in a header ahead of the elements. The
// atomic variant is bound where rays are pushed with atomicAdd; the plain one where the length is
// only read or reset. getLength returns just the header since the trailing array is runtime-sized.
export const rayQueueStruct = new DependentStructTypeNode( {
	length: 'uint',
	elements: `array<${ traceQueuedRayStruct.name }>`,
}, 'RayQueue', [ traceQueuedRayStruct ] );
rayQueueStruct.getLength = () => 4;

export const rayQueueAtomicStruct = new DependentStructTypeNode( {
	length: { type: 'uint', atomic: true },
	elements: `array<${ traceQueuedRayStruct.name }>`,
}, 'RayQueue', [ traceQueuedRayStruct ] );
rayQueueAtomicStruct.getLength = () => 4;

// Round-robin queue of pixel indices waiting for a free path slot when the output resolution exceeds
// the ray data pool. The non-atomic variant is used for contention-free initialization.
export const pixelQueueStruct = new DependentStructTypeNode( {
	current: { type: 'uint', atomic: true },
	elementCount: 'uint',
	elements: 'array<atomic<u32>>',
}, 'PixelQueue' );
pixelQueueStruct.getLength = () => 2;

export const pixelQueueNonAtomicStruct = new DependentStructTypeNode( {
	current: 'uint',
	elementCount: 'uint',
	elements: 'array<u32>',
}, 'PixelQueue' );
pixelQueueNonAtomicStruct.getLength = () => 2;
