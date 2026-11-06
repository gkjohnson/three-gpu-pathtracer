import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { LIGHT_FAR_DISTANCE } from './lights.wgsl.js';
import { offsetRayOriginFunc } from './utils.wgsl.js';

// Random walk subsurface scattering, following Cycles' subsurface_random_walk.h
// https://github.com/blender/cycles/blob/a456b761034dda42c32eef9f4aae0fa5a5c9f604/src/kernel/integrator/subsurface_random_walk.h

// the smallest attenuation color used to derive a medium's extinction, keeping the log finite
const MEDIUM_MIN_ATTENUATION = 1e-6;

// the throughput below which a walk stops, matching Cycles' VOLUME_THROUGHPUT_EPSILON
export const MEDIUM_THROUGHPUT_EPSILON = 1e-6;

// the largest phase anisotropy used, short of the +/- 1 delta phase function the scatter albedo
// inversion and the Henyey-Greenstein pdf divide by zero at
const MEDIUM_MAX_ANISOTROPY = 0.999;

// The media a path is inside of, as in Cycles' volume_stack.h: the medium ids of up to four volumes, packed
// at the front with the empty value after them. A volume entered past a full stack is ignored
export const MEDIUM_STACK_EMPTY = 0xffffffff;
export const MEDIUM_STACK_SIZE = 4;

// how many surfaces the ray finding the volumes around a camera ray's origin passes
const MEDIUM_ORIGIN_MAX_HITS = 16;

// the shadow ray length past which the light is distant, as the far distance shortened by the light epsilon
const MEDIUM_DISTANT_SHADOW_DISTANCE = 0.5 * LIGHT_FAR_DISTANCE;

// The media of a stack combined. One that scatters is walked, while one that only absorbs attenuates the
// segments through it. A walk through fog samples light at each scatter event, as Cycles does in volumes,
// where a subsurface walk doesn't
export const mediumStruct = new StructTypeNode( {
	stack: 'vec4u',
	scatters: 'bool',
	fog: 'bool',
	extinction: 'vec3f',
	albedo: 'vec3f',
	anisotropy: 'float',
}, 'Medium' );

// a medium in a storage buffer, which can't hold bools, for walks that span passes
export const mediumStateStruct = new StructTypeNode( {
	stack: 'vec4u',

	extinction: 'vec3f',
	scatters: 'uint',

	albedo: 'vec3f',
	anisotropy: 'float',

	fog: 'uint',
}, 'MediumState' );

export const storeMediumFn = wgslTagFn/* wgsl */`

	fn storeMedium( medium: ${ mediumStruct } ) -> ${ mediumStateStruct } {

		var state: ${ mediumStateStruct };
		state.stack = medium.stack;
		state.extinction = medium.extinction;
		state.scatters = select( 0u, 1u, medium.scatters );
		state.albedo = medium.albedo;
		state.anisotropy = medium.anisotropy;
		state.fog = select( 0u, 1u, medium.fog );
		return state;

	}

`;

export const loadMediumFn = wgslTagFn/* wgsl */`

	fn loadMedium( state: ${ mediumStateStruct } ) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.stack = state.stack;
		medium.extinction = state.extinction;
		medium.scatters = state.scatters != 0u;
		medium.albedo = state.albedo;
		medium.anisotropy = state.anisotropy;
		medium.fog = state.fog != 0u;
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

// Refracting in through a front face pushes the hit object's volume, by its medium id, unless it has none or
// is already on the stack
export const mediumStackEnterFunc = ( transforms, materials ) => wgslTagFn/* wgsl */`

	fn mediumStackEnter( stack: vec4u, object: u32 ) -> vec4u {

		let transform = ${ transforms }[ object ];
		let material = ${ materials }[ transform.materialIndex ];
		if ( all( ${ materialExtinctionFn }( material.attenuationColor, material.attenuationDistance ) <= vec3f( 0.0 ) ) ) {

			return stack;

		}

		var result = stack;
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( result[ i ] == transform.mediumId ) {

				break;

			}

			if ( result[ i ] == ${ MEDIUM_STACK_EMPTY }u ) {

				result[ i ] = transform.mediumId;
				break;

			}

		}

		return result;

	}

`;

// ... and refracting out through a back face removes it, keeping the rest of the stack packed in order
export const mediumStackExitFunc = ( transforms ) => wgslTagFn/* wgsl */`

	fn mediumStackExit( stack: vec4u, object: u32 ) -> vec4u {

		let id = ${ transforms }[ object ].mediumId;
		var result = vec4u( ${ MEDIUM_STACK_EMPTY }u );
		var count = 0u;
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( stack[ i ] != id ) {

				result[ count ] = stack[ i ];
				count ++;

			}

		}

		return result;

	}

`;

// The volumes a camera ray's origin is inside of, found as Cycles' integrator_volume_stack_init does: a ray from
// the origin meets the boundaries of the volumes around it, and one whose back face comes before any of its front
// faces contains the origin. Like Cycles, it relies on closed volumes with outward facing normals
export const originMediumStackFunc = ( raycastFirstHit, raycastOutput, transforms, materials, mediumStackEnterFn ) => wgslTagFn/* wgsl */`

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

			let transform = ${ transforms }[ hit.objectIndex ];
			let material = ${ materials }[ transform.materialIndex ];
			let isVolume = material.fogVolume != 0 || ( material.transmission > 0.0 && material.thinWall == 0 );
			if ( isVolume && ! any( outside == vec4u( transform.mediumId ) ) ) {

				if ( hit.side < 0.0 ) {

					stack = ${ mediumStackEnterFn }( stack, hit.objectIndex );

				} else if ( outsideCount < ${ MEDIUM_STACK_SIZE }u ) {

					outside[ outsideCount ] = transform.mediumId;
					outsideCount ++;

				}

			}

			ray.origin = ${ offsetRayOriginFunc }( ray.origin + ray.direction * hit.dist, ray.direction, hit.normal );

		}

		return stack;

	}

`;

// The medium of a stack. Overlapping volumes sum their coefficients as in Cycles, with a phase anisotropy
// averaged by scattering in place of Cycles' mixture of phase functions
export const stackMediumFunc = ( transforms, materials ) => wgslTagFn/* wgsl */`

	fn stackMedium( stack: vec4u ) -> ${ mediumStruct } {

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
			let entryAnisotropy = clamp( material.scatterAnisotropy, - ${ MEDIUM_MAX_ANISOTROPY }, ${ MEDIUM_MAX_ANISOTROPY } );
			let entryExtinction = ${ materialExtinctionFn }( material.attenuationColor, material.attenuationDistance );

			// a fog volume's color is its single scatter albedo already
			let isFog = material.fogVolume != 0;
			let entryAlbedo = select( ${ singleScatterAlbedoFn }( material.multiscatterColor * material.scatterStrength, entryAnisotropy ), material.multiscatterColor, isFog );
			let entryScattering = entryAlbedo * entryExtinction;
			let weight = dot( entryScattering, vec3f( 1.0 / 3.0 ) );
			extinction += entryExtinction;
			scattering += entryScattering;
			maxAlbedo = max( maxAlbedo, entryAlbedo );
			anisotropy += entryAnisotropy * weight;
			anisotropyWeight += weight;
			fog = fog || isFog;

		}

		// a channel without extinction never scatters, and keeps the largest albedo for the channel choice
		var medium: ${ mediumStruct };
		medium.stack = stack;
		medium.fog = fog;
		medium.extinction = extinction;
		medium.albedo = select( maxAlbedo, scattering / extinction, extinction > vec3f( 0.0 ) );
		medium.anisotropy = select( 0.0, anisotropy / anisotropyWeight, anisotropyWeight > 0.0 );
		medium.scatters = any( medium.albedo > vec3f( 0.0 ) ) && any( extinction > vec3f( 0.0 ) );
		return medium;

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
