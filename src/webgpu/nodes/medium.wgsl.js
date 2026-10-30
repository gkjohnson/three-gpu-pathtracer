import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { sampleHenyeyGreensteinFn, henyeyGreensteinPdfFn, directionFromCosineFn, dwivediPhasePdfFn, sampleDwivediPhaseFn, misHeuristicFn } from './sampling.wgsl.js';
import { LIGHT_FAR_DISTANCE, DIR_LIGHT_TYPE, ENVIRONMENT_LIGHT_TYPE } from './lights.wgsl.js';
import { lightRecordStruct } from './structs.wgsl.js';

// Random walk subsurface scattering, following Cycles' subsurface_random_walk.h
// TODO: consider removing the Dwivedi guiding, which may help less here than in Cycles

// the smallest attenuation color used to derive a medium's extinction, keeping the log finite
const MEDIUM_MIN_ATTENUATION = 1e-6;

// the largest single scatter albedo used for the guiding diffusion length, which is infinite at one, as in Cycles
const MEDIUM_MAX_GUIDING_ALBEDO = 0.999999;

// how many of the shortest mean free paths the first segment looks for the opposite interface, as in Cycles
const MEDIUM_OPPOSITE_SEARCH_PATHS = 10;

// the throughput below which a walk stops, matching Cycles' VOLUME_THROUGHPUT_EPSILON
export const MEDIUM_THROUGHPUT_EPSILON = 1e-6;

// The media a path is inside of, as in Cycles' volume_stack.h: the object indices of up to four volumes,
// packed at the front with the empty value after them. A volume entered past a full stack is ignored
export const MEDIUM_STACK_EMPTY = 0xffffffff;
export const MEDIUM_STACK_SIZE = 4;

// how many fog volume boundaries a shadow ray passes before it counts as occluded
const MEDIUM_SHADOW_MAX_BOUNDARIES = 8;

// how many surfaces the ray finding the volumes a camera ray starts in passes
const MEDIUM_ORIGIN_MAX_HITS = 16;

// the smallest distance from a segment to the light point its equiangular samples are drawn toward, keeping
// their pdf finite
const MEDIUM_EQUIANGULAR_MIN_DISTANCE = 1e-4;

// the bit flags of the stored medium and segment
const MEDIUM_INSIDE = 1;
const MEDIUM_FIRST_SEGMENT = 2;
const MEDIUM_HAS_OPPOSITE = 4;
const MEDIUM_FOG = 8;
const SEGMENT_GUIDABLE = 1;
const SEGMENT_GUIDED = 2;
const SEGMENT_BACKWARD = 4;

// The media of the stack combined. "inside" marks one that scatters, which is walked, while one that only
// absorbs attenuates the segments through it. A walk through fog samples light at each scatter event, as
// Cycles does in volumes, where a subsurface walk doesn't
export const mediumStruct = new StructTypeNode( {
	stack: 'vec4u',
	inside: 'bool',
	fog: 'bool',
	object: 'uint',
	extinction: 'vec3f',
	albedo: 'vec3f',
	anisotropy: 'float',

	// guiding toward the entry point, or toward the opposite interface found by the first segment
	entryPosition: 'vec3f',
	entryNormal: 'vec3f',
	diffusionLength: 'float',
	phaseLog: 'float',
	guidedFraction: 'float',
	firstSegment: 'bool',
	hasOpposite: 'bool',
	oppositeDistance: 'float',
}, 'Medium' );

// how the current segment's direction was sampled, which its distance pdf depends on
export const mediumSegmentStruct = new StructTypeNode( {
	guidable: 'bool',
	guided: 'bool',
	backward: 'bool',
	backwardFraction: 'float',
	forwardFactor: 'float',
	backwardFactor: 'float',
	forwardStretch: 'float',
	backwardStretch: 'float',
}, 'MediumSegment' );

// a medium and its segment in a storage buffer, which can't hold bools, for walks that span passes
export const mediumStateStruct = new StructTypeNode( {
	stack: 'vec4u',

	extinction: 'vec3f',
	object: 'uint',

	albedo: 'vec3f',
	anisotropy: 'float',

	entryPosition: 'vec3f',
	diffusionLength: 'float',

	entryNormal: 'vec3f',
	phaseLog: 'float',

	guidedFraction: 'float',
	oppositeDistance: 'float',
	flags: 'uint',
	segmentFlags: 'uint',

	backwardFraction: 'float',
	forwardFactor: 'float',
	backwardFactor: 'float',
	forwardStretch: 'float',

	backwardStretch: 'float',
}, 'MediumState' );

export const storeMediumFn = wgslTagFn/* wgsl */`

	fn storeMedium( medium: ${ mediumStruct }, segment: ${ mediumSegmentStruct } ) -> ${ mediumStateStruct } {

		var state: ${ mediumStateStruct };
		state.stack = medium.stack;
		state.extinction = medium.extinction;
		state.object = medium.object;
		state.albedo = medium.albedo;
		state.anisotropy = medium.anisotropy;
		state.entryPosition = medium.entryPosition;
		state.diffusionLength = medium.diffusionLength;
		state.entryNormal = medium.entryNormal;
		state.phaseLog = medium.phaseLog;
		state.guidedFraction = medium.guidedFraction;
		state.oppositeDistance = medium.oppositeDistance;
		state.flags =
			select( 0u, ${ MEDIUM_INSIDE }u, medium.inside ) |
			select( 0u, ${ MEDIUM_FIRST_SEGMENT }u, medium.firstSegment ) |
			select( 0u, ${ MEDIUM_HAS_OPPOSITE }u, medium.hasOpposite ) |
			select( 0u, ${ MEDIUM_FOG }u, medium.fog );

		state.segmentFlags =
			select( 0u, ${ SEGMENT_GUIDABLE }u, segment.guidable ) |
			select( 0u, ${ SEGMENT_GUIDED }u, segment.guided ) |
			select( 0u, ${ SEGMENT_BACKWARD }u, segment.backward );

		state.backwardFraction = segment.backwardFraction;
		state.forwardFactor = segment.forwardFactor;
		state.backwardFactor = segment.backwardFactor;
		state.forwardStretch = segment.forwardStretch;
		state.backwardStretch = segment.backwardStretch;
		return state;

	}

`;

export const loadMediumFn = wgslTagFn/* wgsl */`

	fn loadMedium( state: ${ mediumStateStruct } ) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.stack = state.stack;
		medium.inside = ( state.flags & ${ MEDIUM_INSIDE }u ) != 0u;
		medium.fog = ( state.flags & ${ MEDIUM_FOG }u ) != 0u;
		medium.object = state.object;
		medium.extinction = state.extinction;
		medium.albedo = state.albedo;
		medium.anisotropy = state.anisotropy;
		medium.entryPosition = state.entryPosition;
		medium.entryNormal = state.entryNormal;
		medium.diffusionLength = state.diffusionLength;
		medium.phaseLog = state.phaseLog;
		medium.guidedFraction = state.guidedFraction;
		medium.firstSegment = ( state.flags & ${ MEDIUM_FIRST_SEGMENT }u ) != 0u;
		medium.hasOpposite = ( state.flags & ${ MEDIUM_HAS_OPPOSITE }u ) != 0u;
		medium.oppositeDistance = state.oppositeDistance;
		return medium;

	}

`;

export const loadMediumSegmentFn = wgslTagFn/* wgsl */`

	fn loadMediumSegment( state: ${ mediumStateStruct } ) -> ${ mediumSegmentStruct } {

		var segment: ${ mediumSegmentStruct };
		segment.guidable = ( state.segmentFlags & ${ SEGMENT_GUIDABLE }u ) != 0u;
		segment.guided = ( state.segmentFlags & ${ SEGMENT_GUIDED }u ) != 0u;
		segment.backward = ( state.segmentFlags & ${ SEGMENT_BACKWARD }u ) != 0u;
		segment.backwardFraction = state.backwardFraction;
		segment.forwardFactor = state.forwardFactor;
		segment.backwardFactor = state.backwardFactor;
		segment.forwardStretch = state.forwardStretch;
		segment.backwardStretch = state.backwardStretch;
		return segment;

	}

`;

// A material's extinction from its glTF attenuation, zero for one without a volume
const materialExtinctionFn = wgslTagFn/* wgsl */`

	fn materialExtinction( attenuationColor: vec3f, attenuationDistance: f32 ) -> vec3f {

		return - log( max( attenuationColor, vec3f( ${ MEDIUM_MIN_ATTENUATION } ) ) ) / attenuationDistance;

	}

`;

// The medium entered at a boundary, not "inside" if it doesn't scatter
const enterMediumFn = wgslTagFn/* wgsl */`

	fn enterMedium(
		extinction: vec3f, albedo: vec3f, anisotropy: f32,
		object: u32, position: vec3f, normal: vec3f,
	) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.extinction = extinction;
		medium.inside = any( albedo > vec3f( 0.0 ) ) && any( medium.extinction > vec3f( 0.0 ) );
		medium.object = object;
		medium.albedo = albedo;
		medium.anisotropy = anisotropy;
		medium.entryPosition = position;
		medium.entryNormal = normal;
		medium.firstSegment = true;

		// The diffusion length comes from the highest albedo (eq. 67 of "Zero-Variance Theory for Efficient
		// Subsurface Scattering", d'Eon and Křivánek 2020), and anisotropic media are guided less
		let maxAlbedo = min( max( max( albedo.r, albedo.g ), albedo.b ), ${ MEDIUM_MAX_GUIDING_ALBEDO } );
		medium.diffusionLength = 1.0 / sqrt( 1.0 - pow( maxAlbedo, 2.44294 - 0.0215813 * maxAlbedo + 0.578637 / maxAlbedo ) );
		medium.phaseLog = log( ( medium.diffusionLength + 1.0 ) / ( medium.diffusionLength - 1.0 ) );
		medium.guidedFraction = 1.0 - max( 0.5, pow( abs( anisotropy ), 0.125 ) );

		// at low albedo the length reaches one and the guided distribution degenerates
		if ( medium.diffusionLength <= 1.0 ) {

			medium.guidedFraction = 0.0;

		}

		return medium;

	}

`;

// Refracting in through a front face pushes the volume the hit object's face bounds, by its medium id, unless it
// has none or is already on the stack
export const mediumStackEnterFunc = ( transforms, materials ) => wgslTagFn/* wgsl */`

	fn mediumStackEnter( stack: vec4u, object: u32 ) -> vec4u {

		let id = ${ transforms }[ object ].mediumId;
		let material = ${ materials }[ ${ transforms }[ id ].materialIndex ];
		if ( all( ${ materialExtinctionFn }( material.attenuationColor, material.attenuationDistance ) <= vec3f( 0.0 ) ) ) {

			return stack;

		}

		var result = stack;
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( result[ i ] == id ) {

				break;

			}

			if ( result[ i ] == ${ MEDIUM_STACK_EMPTY }u ) {

				result[ i ] = id;
				break;

			}

		}

		return result;

	}

`;

// ... and refracting out through a back face removes it, moving the entries after it up
export const mediumStackExitFunc = ( transforms ) => wgslTagFn/* wgsl */`

	fn mediumStackExit( stack: vec4u, object: u32 ) -> vec4u {

		let id = ${ transforms }[ object ].mediumId;
		var result = stack;
		var found = false;
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			found = found || stack[ i ] == id;
			if ( found ) {

				let next = stack[ min( i + 1u, ${ MEDIUM_STACK_SIZE - 1 }u ) ];
				result[ i ] = select( ${ MEDIUM_STACK_EMPTY }u, next, i + 1u < ${ MEDIUM_STACK_SIZE }u );

			}

		}

		return result;

	}

`;

// The medium of a stack, entered at the given boundary. Overlapping volumes sum their coefficients as in Cycles,
// with a phase anisotropy averaged by scattering in place of Cycles' mixture of phase functions
export const stackMediumFunc = ( transforms, materials ) => wgslTagFn/* wgsl */`

	fn stackMedium( stack: vec4u, object: u32, position: vec3f, normal: vec3f ) -> ${ mediumStruct } {

		var extinction = vec3f( 0.0 );
		var scattering = vec3f( 0.0 );
		var maxAlbedo = vec3f( 0.0 );
		var anisotropy = 0.0;
		var anisotropyWeight = 0.0;
		var fog = false;
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( stack[ i ] == ${ MEDIUM_STACK_EMPTY }u ) {

				break;

			}

			let material = ${ materials }[ ${ transforms }[ stack[ i ] ].materialIndex ];
			let entryExtinction = ${ materialExtinctionFn }( material.attenuationColor, material.attenuationDistance );
			let entryScattering = material.scatterAlbedo * entryExtinction;
			let weight = dot( entryScattering, vec3f( 1.0 / 3.0 ) );
			extinction += entryExtinction;
			scattering += entryScattering;
			maxAlbedo = max( maxAlbedo, material.scatterAlbedo );
			anisotropy += material.scatterAnisotropy * weight;
			anisotropyWeight += weight;
			fog = fog || material.fogVolume != 0;

		}

		// a channel without extinction never scatters, and keeps the largest albedo for the channel choice
		let albedo = select( maxAlbedo, scattering / extinction, extinction > vec3f( 0.0 ) );
		let meanAnisotropy = select( 0.0, anisotropy / anisotropyWeight, anisotropyWeight > 0.0 );

		var medium = ${ enterMediumFn }( extinction, albedo, meanAnisotropy, object, position, normal );
		medium.stack = stack;
		medium.fog = fog;

		// the guiding steers a walk back out through the surface it entered, which fog has no use for
		if ( fog ) {

			medium.guidedFraction = 0.0;

		}

		return medium;

	}

`;

// The volumes a camera ray's origin is inside of, found as Cycles' integrator_volume_stack_init does: a ray traced
// from the origin meets the boundaries of the volumes around it, and one whose back face comes before any of its
// front faces contains the origin. Like Cycles, it relies on closed volumes with outward facing normals
export const originMediumStackFunc = ( raycastFirstHit, raycastOutput, offsetRayOrigin, transforms, materials, mediumStackEnterFn ) => wgslTagFn/* wgsl */`

	fn originMediumStack( origin: vec3f ) -> vec4u {

		var stack = vec4u( ${ MEDIUM_STACK_EMPTY }u );

		// the volumes whose front face was met first, so the origin is outside of them
		var outside = vec4u( ${ MEDIUM_STACK_EMPTY }u );
		var outsideCount = 0u;

		var ray: ${ rayStruct };
		ray.origin = origin;
		ray.direction = vec3f( 0.0, 0.0, 1.0 );
		ray.maxDist = 0.0;
		for ( var i = 0u; i < ${ MEDIUM_ORIGIN_MAX_HITS }u; i ++ ) {

			var hit: ${ raycastOutput };
			if ( ! ${ raycastFirstHit }( ray, &hit ) ) {

				break;

			}

			let material = ${ materials }[ ${ transforms }[ hit.objectIndex ].materialIndex ];
			let isVolume = material.fogVolume != 0 || ( material.transmission > 0.0 && material.thinWall == 0 );
			if ( isVolume ) {

				let id = ${ transforms }[ hit.objectIndex ].mediumId;
				let isOutside = any( outside == vec4u( id ) );
				if ( hit.side > 0.0 && ! isOutside && outsideCount < ${ MEDIUM_STACK_SIZE }u ) {

					outside[ outsideCount ] = id;
					outsideCount ++;

				} else if ( hit.side < 0.0 && ! isOutside ) {

					stack = ${ mediumStackEnterFn }( stack, hit.objectIndex );

				}

			}

			ray.origin = ${ offsetRayOrigin }( ray.origin + ray.direction * hit.dist, ray.direction, hit.normal );

		}

		return stack;

	}

`;

// The stack a surface's shadow ray starts in. A light on the far side of a volume's boundary is reached through
// it, entering or leaving the volume
export const shadowMediumStackFunc = ( mediumStackEnterFn, mediumStackExitFn ) => wgslTagFn/* wgsl */`

	fn shadowMediumStack(
		stack: vec4u, object: u32, side: f32, thinWall: bool,
		direction: vec3f, lightDirection: vec3f, normal: vec3f,
	) -> vec4u {

		let crossesSurface = dot( direction, normal ) * dot( lightDirection, normal ) > 0.0;
		if ( ! crossesSurface || thinWall ) {

			return stack;

		}

		if ( side > 0.0 ) {

			return ${ mediumStackEnterFn }( stack, object );

		}

		return ${ mediumStackExitFn }( stack, object );

	}

`;

// The summed extinction of a stack's volumes
const stackExtinctionFunc = ( transforms, materials ) => wgslTagFn/* wgsl */`

	fn stackExtinction( stack: vec4u ) -> vec3f {

		var extinction = vec3f( 0.0 );
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( stack[ i ] == ${ MEDIUM_STACK_EMPTY }u ) {

				break;

			}

			let material = ${ materials }[ ${ transforms }[ stack[ i ] ].materialIndex ];
			extinction += ${ materialExtinctionFn }( material.attenuationColor, material.attenuationDistance );

		}

		return extinction;

	}

`;

// The transmittance of a shadow ray starting inside the stack's volumes. As in Cycles' transparent shadows, the
// boundaries of fog volumes are passed, entering and leaving their volumes, while any other surface occludes
// the light. "forwardBlocked" is set when a face a bsdf ray would hit was passed
export const mediumShadowTransmittanceFunc = ( raycastShadow, raycastOutput, offsetRayOrigin, transforms, materials, mediumStackEnterFn, mediumStackExitFn ) => {

	const stackExtinctionFn = stackExtinctionFunc( transforms, materials );
	return wgslTagFn/* wgsl */`

		fn mediumShadowTransmittance( ray: ${ rayStruct }, stack: vec4u, forwardBlocked: ptr<function, bool> ) -> vec3f {

			var shadowRay = ray;
			var shadowStack = stack;
			var shadowExtinction = ${ stackExtinctionFn }( stack );
			var transmittance = vec3f( 1.0 );
			var remaining = ray.maxDist;
			*forwardBlocked = false;
			for ( var i = 0u; i <= ${ MEDIUM_SHADOW_MAX_BOUNDARIES }u; i ++ ) {

				shadowRay.maxDist = remaining;

				var hit: ${ raycastOutput };
				let occluded = ${ raycastShadow }( shadowRay, &hit );
				*forwardBlocked = *forwardBlocked || hit.forwardBlocked;
				if ( ! occluded ) {

					return transmittance * exp( - shadowExtinction * remaining );

				}

				let material = ${ materials }[ ${ transforms }[ hit.objectIndex ].materialIndex ];
				if ( material.fogVolume == 0 ) {

					break;

				}

				transmittance *= exp( - shadowExtinction * hit.dist );
				if ( hit.side > 0.0 ) {

					shadowStack = ${ mediumStackEnterFn }( shadowStack, hit.objectIndex );

				} else {

					shadowStack = ${ mediumStackExitFn }( shadowStack, hit.objectIndex );

				}

				shadowExtinction = ${ stackExtinctionFn }( shadowStack );

				// a zero distance traces unbounded, so stop once the light is reached
				remaining -= hit.dist;
				if ( remaining <= 0.0 ) {

					return transmittance;

				}

				shadowRay.origin = ${ offsetRayOrigin }( shadowRay.origin + shadowRay.direction * hit.dist, shadowRay.direction, hit.normal );

			}

			return vec3f( 0.0 );

		}

	`;

};

// The point a light sample reaches, which equiangular sampling draws toward. Distant lights have none
export const getLightPointFn = wgslTagFn/* wgsl */`

	fn getLightPoint( position: vec3f, lightRec: ${ lightRecordStruct } ) -> vec4f {

		let isDistant = lightRec.lightType == ${ DIR_LIGHT_TYPE } || lightRec.lightType == ${ ENVIRONMENT_LIGHT_TYPE };
		return select( vec4f( position + lightRec.direction * lightRec.dist, 1.0 ), vec4f( 0.0 ), isDistant );

	}

`;

// The point on a fog segment where light is sampled. As in Cycles it is chosen apart from the distance sample
// that continues the path, between that sample and an equiangular one toward the last sampled light point
// ("Importance Sampling Techniques for Path Tracing in Participating Media", Kulla and Fajardo 2012), weighted
// by one sample MIS. The light point is any one chosen independently of the segment, "w" zero for none.
// Returns the point's scattering and transmittance over its pdf with the MIS weight, zero when the chosen
// strategy has no point
export const sampleVolumeLightPointFn = wgslTagFn/* wgsl */`

	fn sampleVolumeLightPoint(
		medium: ${ mediumStruct }, channelPdf: vec3f, scatterDist: f32, segmentLength: f32,
		origin: vec3f, direction: vec3f, lightPoint: vec4f, u: vec2f, dist: ptr<function, f32>,
	) -> vec3f {

		let scattering = medium.albedo * medium.extinction;
		let scattered = scatterDist < segmentLength;

		// the equiangular distribution over the segment, from the angles to the light point's projection on it
		let toLight = lightPoint.xyz - origin;
		let delta = dot( toLight, direction );
		let height = max( length( toLight - direction * delta ), ${ MEDIUM_EQUIANGULAR_MIN_DISTANCE } );
		let thetaA = atan2( - delta, height );
		let thetaB = atan2( segmentLength - delta, height );
		let hasEquiangular = lightPoint.w != 0.0 && thetaB > thetaA;

		// the distance sample alone, when there is no light point to sample toward
		if ( ! hasEquiangular ) {

			if ( ! scattered ) {

				return vec3f( 0.0 );

			}

			*dist = scatterDist;
			let transmittance = exp( - medium.extinction * scatterDist );
			return scattering * transmittance / dot( channelPdf, medium.extinction * transmittance );

		}

		let isEquiangular = u.x < 0.5;
		var t = scatterDist;
		if ( isEquiangular ) {

			t = clamp( delta + height * tan( mix( thetaA, thetaB, u.y ) ), 0.0, segmentLength );

		} else if ( ! scattered ) {

			return vec3f( 0.0 );

		}

		let transmittance = exp( - medium.extinction * t );
		let distancePdf = select( 0.0, dot( channelPdf, medium.extinction * transmittance ), t < segmentLength );
		let offset = t - delta;
		let equiangularPdf = height / ( ( thetaB - thetaA ) * ( height * height + offset * offset ) );

		let pdf = select( distancePdf, equiangularPdf, isEquiangular );
		let misWeight = ${ misHeuristicFn }( pdf, select( equiangularPdf, distancePdf, isEquiangular ) );
		*dist = t;
		return scattering * transmittance * misWeight / ( 0.5 * pdf );

	}

`;

// The probability of sampling each color channel's distance, in proportion to throughput times albedo
export const mediumChannelPdfFn = wgslTagFn/* wgsl */`

	fn mediumChannelPdf( throughput: vec3f, albedo: vec3f ) -> vec3f {

		let weights = abs( throughput * albedo );
		let weightSum = weights.r + weights.g + weights.b;
		if ( weightSum > 0.0 ) {

			return weights / weightSum;

		}

		return vec3f( 1.0 / 3.0 );

	}

`;

// Samples the distance to the next scatter event, with a guided segment's extinction stretched along its direction
export const sampleMediumDistanceFn = wgslTagFn/* wgsl */`

	fn sampleMediumDistance( medium: ${ mediumStruct }, segment: ${ mediumSegmentStruct }, channelPdf: vec3f, u: vec2f ) -> f32 {

		var channel = 2u;
		if ( u.x < channelPdf.r ) {

			channel = 0u;

		} else if ( u.x < channelPdf.r + channelPdf.g ) {

			channel = 1u;

		}

		var extinction = medium.extinction[ channel ];
		if ( segment.guided ) {

			extinction *= select( segment.forwardStretch, segment.backwardStretch, segment.backward );

		}

		// a channel with no extinction never scatters, and WGSL doesn't guarantee an infinite quotient
		if ( extinction <= 0.0 ) {

			return ${ LIGHT_FAR_DISTANCE };

		}

		return - log( 1.0 - u.y ) / extinction;

	}

`;

// The first segment looks for the walk's own surface on the far side, which backward guiding steers toward
export const findMediumOppositeFn = wgslTagFn/* wgsl */`

	fn findMediumOpposite( medium: ptr<function, ${ mediumStruct }>, origin: vec3f, direction: vec3f, scatterDist: f32, hitOwnSurface: bool, hitDist: f32 ) -> void {

		medium.firstSegment = false;

		let minExtinction = min( min( medium.extinction.r, medium.extinction.g ), medium.extinction.b );
		let searchDist = select( ${ LIGHT_FAR_DISTANCE }, max( scatterDist, ${ MEDIUM_OPPOSITE_SEARCH_PATHS }.0 / minExtinction ), minExtinction > 0.0 );
		if ( hitOwnSurface && hitDist <= searchDist ) {

			medium.hasOpposite = true;
			medium.oppositeDistance = dot( origin + direction * hitDist - medium.entryPosition, - medium.entryNormal );

		}

	}

`;

// Per channel pdf of a segment, combining the classic and guided strategies
const distancePdfFn = wgslTagFn/* wgsl */`

	fn distancePdf( extinction: vec3f, dist: f32, scattered: bool ) -> vec3f {

		let transmittance = exp( - extinction * dist );
		return select( transmittance, extinction * transmittance, scattered );

	}

`;

export const mediumSegmentPdfFn = wgslTagFn/* wgsl */`

	fn mediumSegmentPdf( medium: ${ mediumStruct }, segment: ${ mediumSegmentStruct }, dist: f32, scattered: bool ) -> vec3f {

		let classicPdf = ${ distancePdfFn }( medium.extinction, dist, scattered );
		if ( ! segment.guidable ) {

			return classicPdf;

		}

		let forwardPdf = ${ distancePdfFn }( segment.forwardStretch * medium.extinction, dist, scattered ) * segment.forwardFactor;
		let backwardPdf = ${ distancePdfFn }( segment.backwardStretch * medium.extinction, dist, scattered ) * segment.backwardFactor;
		let guidedPdf = mix( forwardPdf, backwardPdf, segment.backwardFraction );
		return mix( classicPdf, guidedPdf, medium.guidedFraction );

	}

`;

// Samples the direction after a scatter event from the phase function or Dwivedi guiding
export const sampleMediumDirectionFn = wgslTagFn/* wgsl */`

	fn sampleMediumDirection(
		medium: ${ mediumStruct }, position: vec3f, direction: vec3f, guideSample: vec2f, directionSample: vec2f,
		segment: ptr<function, ${ mediumSegmentStruct }>,
	) -> vec3f {

		let v = medium.diffusionLength;
		segment.guided = guideSample.x < medium.guidedFraction;
		segment.backwardFraction = 0.0;
		if ( medium.hasOpposite ) {

			let depth = clamp( dot( position - medium.entryPosition, - medium.entryNormal ), 0.0, medium.oppositeDistance );
			segment.backwardFraction = 1.0 / ( 1.0 + exp( ( medium.oppositeDistance - 2.0 * depth ) / v ) );

		}

		segment.backward = guideSample.y < segment.backwardFraction;

		var newDirection: vec3f;
		var cosTheta: f32;
		if ( segment.guided ) {

			cosTheta = ${ sampleDwivediPhaseFn }( v, medium.phaseLog, directionSample.x );
			cosTheta = select( cosTheta, - cosTheta, segment.backward );
			newDirection = ${ directionFromCosineFn }( medium.entryNormal, cosTheta, directionSample.y );

		} else {

			newDirection = ${ sampleHenyeyGreensteinFn }( direction, medium.anisotropy, directionSample );
			cosTheta = dot( newDirection, medium.entryNormal );

		}

		// the guided direction pdfs relative to the phase function, which cancels in the estimator
		let phasePdf = ${ henyeyGreensteinPdfFn }( dot( direction, newDirection ), medium.anisotropy );
		segment.forwardFactor = ${ dwivediPhasePdfFn }( v, medium.phaseLog, cosTheta ) / phasePdf;
		segment.backwardFactor = ${ dwivediPhasePdfFn }( v, medium.phaseLog, - cosTheta ) / phasePdf;
		segment.forwardStretch = 1.0 - cosTheta / v;
		segment.backwardStretch = 1.0 + cosTheta / v;
		segment.guidable = medium.guidedFraction > 0.0;
		return newDirection;

	}

`;
