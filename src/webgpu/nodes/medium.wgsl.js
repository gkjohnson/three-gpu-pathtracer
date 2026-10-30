import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { sampleHenyeyGreensteinFn, henyeyGreensteinPdfFn, directionFromCosineFn, dwivediPhasePdfFn, sampleDwivediPhaseFn } from './sampling.wgsl.js';
import { LIGHT_FAR_DISTANCE } from './lights.wgsl.js';

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

export const mediumStruct = new StructTypeNode( {
	inside: 'bool',
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

// The medium entered by refracting into a material, not "inside" if the material doesn't scatter
export const enterMediumFn = wgslTagFn/* wgsl */`

	fn enterMedium(
		attenuationColor: vec3f, attenuationDistance: f32, albedo: vec3f, anisotropy: f32,
		object: u32, position: vec3f, normal: vec3f,
	) -> ${ mediumStruct } {

		var medium: ${ mediumStruct };
		medium.extinction = - log( max( attenuationColor, vec3f( ${ MEDIUM_MIN_ATTENUATION } ) ) ) / attenuationDistance;
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
