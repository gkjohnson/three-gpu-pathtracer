import { StructTypeNode } from 'three/webgpu';
import { mediumStruct } from '../../nodes/medium.wgsl.js';
import { hitRecordStruct } from '../../nodes/structs.wgsl.js';
import { DependentStructTypeNode } from '../../nodes/DependentStructTypeNode.js';

// Persistent per-path-slot state. One slot per in-flight path, holding everything needed to resolve
// the previous frame's trace results and stage the next bounce.
const rayDataMembers = {

	throughputColor: 'vec3f',
	sampleIndex: 'uint',

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
	pixelIndex: 'uint',

	lightDirection: 'vec3f',
	lightPdf: 'float',

	lightEmission: 'vec3f',
	lightDist: 'float',

	lightEvalColor: 'vec3f',
	lightEvalPdf: 'float',

	rayIntersectionIndex: 'int',
	shadowRayIntersectionIndex: 'int',
	lightType: 'int',

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

	// scatter events taken in subsurface walks, and in fog, each counted separately from the bounce count
	subsurfaceBounces: 'uint',
	fogBounces: 'uint',

	// whether SubsurfaceKernel walks the path's next segment, cleared once the walk reaches a surface or ends
	walkPending: 'uint',

	// whether the staged segment starts at a subsurface scatter event, where no light is sampled
	mediumScattered: 'uint',

	// whether the staged hit is a scatter event in fog at "origin" rather than a surface
	fogScatter: 'uint',

	// whether the camera ray passed a light, which stays opaque against a transparent background or matte surface
	cameraHitLight: 'uint',

	// the scatter distance sampled for the queued segment in fog, which it's traced up to, or zero outside of fog
	scatterDist: 'float',

	// the MIS weight of the staged surface's emission against the light sampling at the vertex the segment left
	emissionWeight: 'float',

};

// The path's last surface hit, nested first, and its medium, nested at the end to share the ray data buffer
// under the storage buffer limit. Sized separately since nested structs aren't.
export const rayDataStruct = new DependentStructTypeNode( {
	hit: hitRecordStruct.name,
	...rayDataMembers,
	medium: mediumStruct.name,
}, 'RayData', [ hitRecordStruct, mediumStruct ] );

const rayDataLength = new StructTypeNode( rayDataMembers ).getLength();
rayDataStruct.getLength = () => hitRecordStruct.getLength() + rayDataLength + mediumStruct.getLength();

// A ray queued for BVH traversal by the trace kernels. A "maxDist" of zero traces unbounded.
export const traceQueuedRayStruct = new StructTypeNode( {

	origin: 'vec3f',
	pixelIndex: 'uint',

	direction: 'vec3f',

	// the traversal's random sequence index: bounces, alpha pass throughs and subsurface bounces, as in the megakernel
	rngIndex: 'uint',

	sampleIndex: 'uint',
	maxDist: 'float',
	_alignment0: 'uint',
	_alignment1: 'uint',

	// shadow rays only: the optical depth of the media the ray starts in
	mediumDepth: 'vec3f',

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

	// the vertex indices and the triangle's index in its object, as in the raycast's result
	indices: 'vec4u',

}, 'TraceResult' );

// Shadow ray trace result, written by TraceShadowRayKernel at the ray's queue index and consumed by
// LogicKernel the following frame. objectIndex >= 0 encodes an occluded light.
export const shadowTraceResultStruct = new StructTypeNode( {

	// the light let through by the partially transparent surfaces and the volumes passed
	transmittance: 'vec3f',

	objectIndex: 'int',

	// the share of bsdf rays the skipped faces would stop, whose light weight moves to the light sample
	skippedOcclusion: 'float',

}, 'ShadowTraceResult' );

// The ray and shadow ray queues are plain arrays of queued rays, with their append-only lengths in a
// separate counters buffer: storage buffers are always bound as arrays, which can't hold a struct
// ending in a runtime-sized array.
export const RAY_QUEUE_LENGTH = 0;
export const SHADOW_RAY_QUEUE_LENGTH = 1;
export const QUEUE_COUNTER_COUNT = 2;

// The path slots walking through a medium this pass, for SubsurfaceKernel. Its length leads the same u32
// array, ahead of the elements, as SubsurfaceKernel is at its storage buffer limit.
export const MEDIUM_QUEUE_LENGTH = 0;
export const MEDIUM_QUEUE_HEADER = 1;

// The counters of the pixel queue, which is rebuilt after each pass. Pixels behind the rest fill it from the
// front and the others from the back, split at the midpoint of the last rebuild's sample count range.
// TODO: merge into the pixel queue buffer once three can bind a struct ending in a runtime-sized array
export const pixelQueueInfoStruct = new StructTypeNode( {
	frontCount: { type: 'uint', atomic: true },
	backCount: { type: 'uint', atomic: true },
	frontCursor: { type: 'uint', atomic: true },
	backCursor: { type: 'uint', atomic: true },
	minSamples: { type: 'uint', atomic: true },
	maxSamples: { type: 'uint', atomic: true },
	sampleCountMidpoint: { type: 'uint', atomic: true },
}, 'PixelQueueInfo' );

// the pixel index of an idle path slot
export const NO_PIXEL = 0xFFFFFFFF;
