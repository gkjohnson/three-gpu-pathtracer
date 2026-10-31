import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn } from './sampling.wgsl.js';
import { LIGHT_FAR_DISTANCE, DIR_LIGHT_TYPE, ENVIRONMENT_LIGHT_TYPE } from './lights.wgsl.js';
import { lightRecordStruct } from './structs.wgsl.js';

// Random walk subsurface scattering, following Cycles' subsurface_random_walk.h
// https://github.com/blender/cycles/blob/a456b761034dda42c32eef9f4aae0fa5a5c9f604/src/kernel/integrator/subsurface_random_walk.h

// the smallest attenuation color used to derive a medium's extinction, keeping the log finite
const MEDIUM_MIN_ATTENUATION = 1e-6;

// the throughput below which a walk stops, matching Cycles' VOLUME_THROUGHPUT_EPSILON
export const MEDIUM_THROUGHPUT_EPSILON = 1e-6;

// The media a path is inside of, as in Cycles' volume_stack.h: the object indices of up to four volumes,
// packed at the front with the empty value after them. A volume entered past a full stack is ignored
export const MEDIUM_STACK_EMPTY = 0xffffffff;
export const MEDIUM_STACK_SIZE = 4;

// the shadow ray length past which the light is distant, as the far distance shortened by the light epsilon
const MEDIUM_DISTANT_SHADOW_DISTANCE = 0.5 * LIGHT_FAR_DISTANCE;

// how many surfaces the ray finding the volumes a camera ray starts in passes
const MEDIUM_ORIGIN_MAX_HITS = 16;

// the smallest distance from a segment to the light point its equiangular samples are drawn toward, keeping
// their pdf finite
const MEDIUM_EQUIANGULAR_MIN_DISTANCE = 1e-4;

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
}, 'Medium' );

// a medium in a storage buffer, which can't hold bools, for walks that span passes
export const mediumStateStruct = new StructTypeNode( {
	stack: 'vec4u',

	extinction: 'vec3f',
	object: 'uint',

	albedo: 'vec3f',
	anisotropy: 'float',

	inside: 'uint',
	fog: 'uint',
}, 'MediumState' );

export const storeMediumFn = wgslTagFn/* wgsl */`

	fn storeMedium( medium: ${ mediumStruct } ) -> ${ mediumStateStruct } {

		var state: ${ mediumStateStruct };
		state.stack = medium.stack;
		state.extinction = medium.extinction;
		state.object = medium.object;
		state.albedo = medium.albedo;
		state.anisotropy = medium.anisotropy;
		state.inside = select( 0u, 1u, medium.inside );
		state.fog = select( 0u, 1u, medium.fog );
		return state;

	}

`;

export const loadMediumFn = wgslTagFn/* wgsl */`

	fn loadMedium( state: ${ mediumStateStruct } ) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.stack = state.stack;
		medium.inside = state.inside != 0u;
		medium.fog = state.fog != 0u;
		medium.object = state.object;
		medium.extinction = state.extinction;
		medium.albedo = state.albedo;
		medium.anisotropy = state.anisotropy;
		return medium;

	}

`;

// The single scatter albedo of a volume from its perceived multi scatter albedo and phase anisotropy, using the
// inversion from "KHR_materials_scatter" (after Kulla and Conty 2017). A zero multi scatter albedo maps to exactly zero
// https://github.com/KhronosGroup/glTF/pull/2579
const singleScatterAlbedoFn = wgslTagFn/* wgsl */`

	fn singleScatterAlbedo( multiscatterAlbedo: vec3f, anisotropy: f32 ) -> vec3f {

		let a = multiscatterAlbedo;
		let s = clamp( 4.09712 + 4.20863 * a - sqrt( 9.59217 + 41.6808 * a + 17.7126 * a * a ), vec3f( 0.0 ), vec3f( 1.0 ) );
		let s2 = select( s * s, vec3f( 1.0 ), a <= vec3f( 0.0 ) );
		return ( 1.0 - s2 ) / ( 1.0 - anisotropy * s2 );

	}

`;

// A material's extinction from its glTF attenuation, zero for one without a volume
export const materialExtinctionFn = wgslTagFn/* wgsl */`

	fn materialExtinction( attenuationColor: vec3f, attenuationDistance: f32 ) -> vec3f {

		return - log( max( attenuationColor, vec3f( ${ MEDIUM_MIN_ATTENUATION } ) ) ) / attenuationDistance;

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

// The medium of a stack, entered through the given object. Overlapping volumes sum their coefficients as in
// Cycles, with a phase anisotropy averaged by scattering in place of Cycles' mixture of phase functions
export const stackMediumFunc = ( transforms, materials ) => wgslTagFn/* wgsl */`

	fn stackMedium( stack: vec4u, object: u32 ) -> ${ mediumStruct } {

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
			// a fog volume's color is its single scatter albedo already
			let isFog = material.fogVolume != 0;
			let entryAlbedo = select( ${ singleScatterAlbedoFn }( material.multiscatterColor * material.scatterStrength, material.scatterAnisotropy ), material.multiscatterColor, isFog );
			let entryScattering = entryAlbedo * entryExtinction;
			let weight = dot( entryScattering, vec3f( 1.0 / 3.0 ) );
			extinction += entryExtinction;
			scattering += entryScattering;
			maxAlbedo = max( maxAlbedo, entryAlbedo );
			anisotropy += material.scatterAnisotropy * weight;
			anisotropyWeight += weight;
			fog = fog || isFog;

		}

		// a channel without extinction never scatters, and keeps the largest albedo for the channel choice
		var medium: ${ mediumStruct };
		medium.stack = stack;
		medium.object = object;
		medium.fog = fog;
		medium.extinction = extinction;
		medium.albedo = select( maxAlbedo, scattering / extinction, extinction > vec3f( 0.0 ) );
		medium.anisotropy = select( 0.0, anisotropy / anisotropyWeight, anisotropyWeight > 0.0 );
		medium.inside = any( medium.albedo > vec3f( 0.0 ) ) && any( extinction > vec3f( 0.0 ) );
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

// The distance a shadow ray's fog depth is measured back from: the light's. A distant light is outside of every
// closed volume, so the depth is measured from the origin instead, where a far distance would lose its precision
export const fogShadowDistanceFn = wgslTagFn/* wgsl */`

	fn fogShadowDistance( maxDist: f32 ) -> f32 {

		return select( maxDist, 0.0, maxDist >= ${ MEDIUM_DISTANT_SHADOW_DISTANCE } );

	}

`;

// The light a shadow ray starting inside the stack's volumes lets through: what the partially transparent surfaces
// passed let through, times the transmittance of the fog on the way. The traversal passes fog boundaries in any
// order, adding their optical depth to "fogDepth" back from the fog shadow distance, so the stack's volumes cover
// the ray up to it
export const shadowTransmittanceFunc = ( transforms, materials ) => {

	const stackExtinctionFn = stackExtinctionFunc( transforms, materials );
	return wgslTagFn/* wgsl */`

		fn shadowTransmittance( stack: vec4u, maxDist: f32, fogDepth: vec3f, occlusion: f32 ) -> vec3f {

			let depth = fogDepth + ${ stackExtinctionFn }( stack ) * ${ fogShadowDistanceFn }( maxDist );
			return ( 1.0 - occlusion ) * exp( - max( depth, vec3f( 0.0 ) ) );

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
// https://github.com/blender/cycles/blob/a456b761034dda42c32eef9f4aae0fa5a5c9f604/src/kernel/closure/volume.h#L157
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

// Samples the distance to the next scatter event using one color channel's extinction
export const sampleMediumDistanceFn = wgslTagFn/* wgsl */`

	fn sampleMediumDistance( medium: ${ mediumStruct }, channelPdf: vec3f, u: vec2f ) -> f32 {

		var channel = 2u;
		if ( u.x < channelPdf.r ) {

			channel = 0u;

		} else if ( u.x < channelPdf.r + channelPdf.g ) {

			channel = 1u;

		}

		// a channel with no extinction never scatters, and WGSL doesn't guarantee an infinite quotient
		let extinction = medium.extinction[ channel ];
		if ( extinction <= 0.0 ) {

			return ${ LIGHT_FAR_DISTANCE };

		}

		return - log( 1.0 - u.y ) / extinction;

	}

`;

// Per channel pdf of a segment: of scattering at "dist", or of passing it when it didn't scatter
export const mediumDistancePdfFn = wgslTagFn/* wgsl */`

	fn mediumDistancePdf( medium: ${ mediumStruct }, dist: f32, scattered: bool ) -> vec3f {

		let transmittance = exp( - medium.extinction * dist );
		return select( transmittance, medium.extinction * transmittance, scattered );

	}

`;
