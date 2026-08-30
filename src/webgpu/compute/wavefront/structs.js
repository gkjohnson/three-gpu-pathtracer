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

export const queuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	seed: 'uint',

	direction: 'vec3f',
	bsdfPdf: 'float',

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	pixel: 'vec2u',
	transmissiveRay: 'uint',
	minPdf: 'float',

	resultColor: 'vec4f',

	alphaDepth: 'uint',

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

	dist: 'float',
	transmissiveRay: 'uint',
	minPdf: 'float',
	alphaDepth: 'uint',

	resultColor: 'vec4f',

	// carried through so a ray that passes an alpha-tested surface keeps its MIS weight
	bsdfPdf: 'float',

}, 'QueuedHit' );

// Queue wrappers that keep the read/write cursors (start/end) in a header ahead of the elements,
// avoiding a separate queueSizes buffer.
export const rayQueueStruct = new DependentStructTypeNode( {
	start: 'uint',
	end: 'uint',
	elements: `array<${ queuedRayStruct.name }>`,
}, 'RayQueue', [ queuedRayStruct ] );
rayQueueStruct.getLength = () => 4;

export const rayQueueAtomicStruct = new DependentStructTypeNode( {
	start: { type: 'uint', atomic: true },
	end: { type: 'uint', atomic: true },
	elements: `array<${ queuedRayStruct.name }>`,
}, 'RayQueue', [ queuedRayStruct ] );
rayQueueAtomicStruct.getLength = () => 4;

export const hitQueueStruct = new DependentStructTypeNode( {
	start: 'uint',
	end: 'uint',
	_padding: 'array<u32, 2>',
	elements: `array<${ queuedHitStruct.name }>`,
}, 'HitQueue', [ queuedHitStruct ] );
hitQueueStruct.getLength = () => 4;

export const hitQueueAtomicStruct = new DependentStructTypeNode( {
	start: { type: 'uint', atomic: true },
	end: { type: 'uint', atomic: true },
	_padding: 'array<u32, 2>',
	elements: `array<${ queuedHitStruct.name }>`,
}, 'HitQueue', [ queuedHitStruct ] );
hitQueueAtomicStruct.getLength = () => 4;
