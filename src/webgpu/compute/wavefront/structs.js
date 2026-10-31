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

	// alpha test pass throughs, counted separately from the bounce count
	alphaDepth: 'uint',

	// the camera segment's maximum trace distance, carried across alpha pass throughs
	maxDist: 'float',

	// the path's hero wavelength, negative until its reconstruction weight is applied at the
	// first dispersive interaction
	dispersionWavelength: 'float',

	// the first scatter's albedo and normal, 8 bits per channel, for the denoiser's auxiliary buffers
	auxAlbedo: 'uint',
	auxNormal: 'uint',

	// scatter events taken in subsurface walks and fog scatters continued after, each counted separately
	// from the bounce count
	subsurfaceBounces: 'uint',
	fogBounces: 'uint',

	// whether MediumKernel walks the path's next segment, cleared once the walk reaches a surface or ends.
	// WALK_PENDING_CAMERA marks a camera ray's first pass
	walkPending: 'uint',

	// whether the staged segment starts at a medium scatter event, where no light is sampled
	mediumScattered: 'uint',

	// whether the staged hit is a scatter event in fog at "origin", a path vertex
	mediumVertex: 'uint',

	// the point the last light sample reached, which fog segments draw equiangular samples toward
	lightPoint: 'vec4f',

	// The light sampled from a point on the last fog segment, apart from the surface's: MediumKernel stages
	// the point and its weight, which LogicKernel samples a light from, giving the color its shadow ray
	// resolves the following frame. The color is kept apart since MediumKernel stages the next point first
	volumeLightPosition: 'vec3f',
	volumeShadowRayIntersectionIndex: 'int',

	volumePointWeight: 'vec3f',
	volumeLightMisWeight: 'float',

	volumeLightColor: 'vec3f',
	volumeLightDist: 'float',

	volumeLightDirection: 'vec3f',

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

	// shadow rays only: the media the ray starts in
	mediumStack: 'vec4u',

}, 'TraceQueuedRay' );

// the object index MediumKernel writes for a walk ending at a scatter event in fog
export const MEDIUM_SCATTER_HIT = - 2;

// The "walkPending" value of a camera ray found inside a medium after it was queued for tracing. Its first
// walk pass writes its hit into that ray's unused result entry rather than one from the back
export const WALK_PENDING_CAMERA = 2;

// Compact trace result, written by the trace kernels at the ray's queue index and consumed by
// LogicKernel the following frame. objectIndex < 0 encodes a miss, or a scatter event in fog.
export const intersectionResultStruct = new StructTypeNode( {

	barycoord: 'vec3f',
	objectIndex: 'int',

	position: 'vec3f',
	dist: 'float',

	normal: 'vec3f',
	side: 'float',

	indices: 'vec3u',

	// shadow rays only: a face a bsdf ray would hit was passed
	forwardBlocked: 'uint',

	// shadow rays only: the transmittance through the volumes on the way to the light
	transmittance: 'vec3f',

}, 'TraceResult' );

// The ray and shadow ray queues are plain arrays of queued rays, with their append-only lengths in a
// separate counters buffer: storage buffers are always bound as arrays, which can't hold a struct
// ending in a runtime-sized array.
export const RAY_QUEUE_LENGTH = 0;
export const SHADOW_RAY_QUEUE_LENGTH = 1;
export const QUEUE_COUNTER_COUNT = 2;

// The path slots walking through a medium this pass, for MediumKernel. Its length, and the count of walk hits
// taken from the back of the ray results, lead the same u32 array, ahead of the elements, as MediumKernel is
// at its storage buffer limit.
export const MEDIUM_QUEUE_LENGTH = 0;
export const MEDIUM_QUEUE_HIT_COUNT = 1;
export const MEDIUM_QUEUE_HEADER = 2;

// Round-robin queue of pixel indices waiting for a free path slot when the output resolution exceeds
// the ray data pool, sized to the pixel count so retiring slots can always return their pixel. Its
// counters lead the same u32 array, ahead of the elements.
export const PIXEL_QUEUE_CURRENT = 0;
export const PIXEL_QUEUE_ELEMENT_COUNT = 1;
export const PIXEL_QUEUE_HEADER = 2;
