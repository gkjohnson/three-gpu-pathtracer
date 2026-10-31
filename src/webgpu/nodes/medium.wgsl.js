import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { LIGHT_FAR_DISTANCE } from './lights.wgsl.js';
import { materialStruct } from './structs.wgsl.js';

// Random walk subsurface scattering, following Cycles' subsurface_random_walk.h
// https://github.com/blender/cycles/blob/a456b761034dda42c32eef9f4aae0fa5a5c9f604/src/kernel/integrator/subsurface_random_walk.h

// the smallest attenuation color used to derive a medium's extinction, keeping the log finite
const MEDIUM_MIN_ATTENUATION = 1e-6;

// the throughput below which a walk stops, matching Cycles' VOLUME_THROUGHPUT_EPSILON
export const MEDIUM_THROUGHPUT_EPSILON = 1e-6;

export const mediumStruct = new StructTypeNode( {
	inside: 'bool',
	object: 'uint',
	extinction: 'vec3f',
	albedo: 'vec3f',
	anisotropy: 'float',
}, 'Medium' );

// a medium in a storage buffer, which can't hold bools, for walks that span passes
export const mediumStateStruct = new StructTypeNode( {
	extinction: 'vec3f',
	object: 'uint',

	albedo: 'vec3f',
	anisotropy: 'float',

	inside: 'uint',
}, 'MediumState' );

export const storeMediumFn = wgslTagFn/* wgsl */`

	fn storeMedium( medium: ${ mediumStruct } ) -> ${ mediumStateStruct } {

		var state: ${ mediumStateStruct };
		state.extinction = medium.extinction;
		state.object = medium.object;
		state.albedo = medium.albedo;
		state.anisotropy = medium.anisotropy;
		state.inside = select( 0u, 1u, medium.inside );
		return state;

	}

`;

export const loadMediumFn = wgslTagFn/* wgsl */`

	fn loadMedium( state: ${ mediumStateStruct } ) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.inside = state.inside != 0u;
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

// The medium entered by refracting into a material, not "inside" if the material doesn't scatter
export const enterMediumFn = wgslTagFn/* wgsl */`

	fn enterMedium( material: ${ materialStruct }, object: u32 ) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.extinction = - log( max( material.attenuationColor, vec3f( ${ MEDIUM_MIN_ATTENUATION } ) ) ) / material.attenuationDistance;
		medium.albedo = ${ singleScatterAlbedoFn }( material.multiscatterColor * material.scatterStrength, material.scatterAnisotropy );
		medium.inside = any( medium.albedo > vec3f( 0.0 ) ) && any( medium.extinction > vec3f( 0.0 ) );
		medium.object = object;
		medium.anisotropy = material.scatterAnisotropy;
		return medium;

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
