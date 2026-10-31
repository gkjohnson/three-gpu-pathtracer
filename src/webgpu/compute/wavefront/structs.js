import { StructTypeNode } from 'three/webgpu';
import { mediumStateStruct } from '../../nodes/medium.wgsl.js';

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
const rayDataMembers = {

	throughputColor: 'vec3f',
	currentBounce: 'uint',

	resultColor: 'vec4f',

	emission: 'vec3f',
	scatterPdf: 'float',

	scatterColor: 'vec3f',

	// the smallest scatter pdf seen along the path, for the glossy filter
	minPdf: 'float',

	origin: 'vec3f',

	// whether every scatter so far has been transmissive, for the background modes
	isFullyTransmissive: 'uint',

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

	// the traced segment length, for the transmission attenuation applied by MaterialKernel
	dist: 'float',

	// alpha test pass throughs, counted separately from the bounce count, and how far along the ray they
	// moved the start of its traversal. The ray keeps the origin it scattered from
	alphaDepth: 'uint',
	rayStart: 'float',

	// the camera segment's maximum trace distance, carried across alpha pass throughs
	maxDist: 'float',

	// the path's hero wavelength, negative until its reconstruction weight is applied at the
	// first dispersive interaction
	dispersionWavelength: 'float',

	// the first scatter's albedo and normal, 8 bits per channel, for the denoiser's auxiliary buffers
	auxAlbedo: 'uint',
	auxNormal: 'uint',

	// scatter events taken inside media, counted separately from the bounce count
	subsurfaceBounces: 'uint',

	// whether MediumKernel walks the path's next segment, cleared once the walk reaches a surface or ends
	walkPending: 'uint',

	// whether the staged segment starts at a medium scatter event, where no light is sampled
	mediumScattered: 'uint',

};

// The path's medium, nested at the end to share the ray data buffer under the storage buffer limit. Sized
// separately since nested structs aren't.
export const rayDataStruct = new DependentStructTypeNode( {
	...rayDataMembers,
	medium: mediumStateStruct.name,
}, 'RayData', [ mediumStateStruct ] );

const rayDataLength = new StructTypeNode( rayDataMembers ).getLength();
rayDataStruct.getLength = () => rayDataLength + mediumStateStruct.getLength();

// A ray queued for BVH traversal by the trace kernels. A "maxDist" of zero traces unbounded.
export const traceQueuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	pixelIndex: 'uint',

	direction: 'vec3f',

	// the traversal's random sequence index: bounces, alpha pass throughs and subsurface bounces, as in the megakernel
	rngIndex: 'uint',

	seed: 'uint',
	maxDist: 'float',
	_alignment0: 'uint',
	_alignment1: 'uint',

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

}, 'TraceResult' );

// Shadow ray trace result, written by TraceShadowRayKernel at the ray's queue index and consumed by
// LogicKernel the following frame. objectIndex >= 0 encodes an occluded light.
export const shadowTraceResultStruct = new StructTypeNode( {

	objectIndex: 'int',

	// the share of bsdf rays the skipped faces would stop, whose light weight moves to the light sample
	skippedOcclusion: 'float',

	// the fraction of light blocked by the partially transparent surfaces passed
	occlusion: 'float',

}, 'ShadowTraceResult' );

// The ray and shadow ray queues are plain arrays of queued rays, with their append-only lengths in a
// separate counters buffer: storage buffers are always bound as arrays, which can't hold a struct
// ending in a runtime-sized array.
export const RAY_QUEUE_LENGTH = 0;
export const SHADOW_RAY_QUEUE_LENGTH = 1;
export const QUEUE_COUNTER_COUNT = 2;

// The path slots walking through a medium this pass, for MediumKernel. Its length leads the same u32
// array, ahead of the elements, as MediumKernel is at its storage buffer limit.
export const MEDIUM_QUEUE_LENGTH = 0;
export const MEDIUM_QUEUE_HEADER = 1;

// Round-robin queue of pixel indices waiting for a free path slot when the output resolution exceeds
// the ray data pool, sized to the pixel count so retiring slots can always return their pixel. Its
// counters lead the same u32 array, ahead of the elements.
export const PIXEL_QUEUE_CURRENT = 0;
export const PIXEL_QUEUE_ELEMENT_COUNT = 1;
export const PIXEL_QUEUE_HEADER = 2;
