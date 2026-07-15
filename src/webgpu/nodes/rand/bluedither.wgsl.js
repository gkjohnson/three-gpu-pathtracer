import { texture, uint, vec4 } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rand4, rngInit, rngNextBounce } from './sobol.wgsl.js';
import { BlueNoiseTexture } from '../../../textures/BlueNoiseTexture.js';

// Based in part on the "stratified" random sample implement from the WebGLPathTracer which
// is in turn based on "hoverinc/ray-tracing-renderer" sampling strategy.
// This random sampling strategy uses the exact sample stratified sobol sequence for every
// pixel on screen, with a fractional blue-noise offset applied. This means that pixels
// along the blue noise stride sample the same directions leading to a blue noise pattern
// emerging in screen space.
//
// References
// - "Blue-Noise Dithered Sampling", Georgiev & Fajardo, SIGGRAPH 2016 Talks
//   https://www.arnoldrenderer.com/research/dither_abstract.pdf
// - Golden-ratio rotation of blue noise via Cranley-Patterson rotation:
//   https://developer.nvidia.com/blog/rendering-in-real-time-with-spatiotemporal-blue-noise-textures-part-2/

// constants
// a maximum number of 100 effects is assumed per ray
const BN_SIZE = 64;
const EFFECTS_PER_BOUNCE = 100;
const GOLDEN_RATIO_FRACT = 0.61803398875;

// construct nodes
const blueNoiseTex = new BlueNoiseTexture( BN_SIZE, 1 );
const blueNoiseTexNode = texture( blueNoiseTex );
const pixelSeed = vec4( 0 ).toVar( 'blueDitherSeed' );
const bounceIndex = uint( 0 ).toVar( 'blueDitherBounceIndex' );

// When dithering, the sobol sampler is seeded with a constant pixel so every pixel
// uses the same sequence, which is modified with the per-pixel blue noise sample.
const blueDitherInitFunc = wgslTagFn/* wgsl */`
	fn blueDitherInitialize( pixel: vec2u, pathIndex: u32, bounceIndex: u32 ) -> void {

		let coord = vec2i( pixel % vec2u( ${ BN_SIZE }u ) );
		${ pixelSeed } = textureLoad( ${ blueNoiseTexNode }, coord, 0 );
		${ bounceIndex } = bounceIndex;
		${ rngInit }( vec2u( 0 ), pathIndex, bounceIndex );

	}
`;

const blueDitherNextBounceFunc = wgslTagFn/* wgsl */`
	fn blueDitherNextBounce() -> void {

		${ bounceIndex }++;
		${ rngNextBounce }();

	}
`;

// The per-pixel scalar is rotated by the golden ratio per dimension. Apply a per-dimension
// offset to reduce the corelation of the sequence.
const blueDitherRand4Func = wgslTagFn/* wgsl */`
	fn blueDitherRand4( effect: u32 ) -> vec4f {

		// Get the dimension index of the current sample, rand rotate each element by a
		// golden ratio Cranley-Patterson rotation value. Each sample is 4 floats so we
		// apply a multiple of 4 so each element is unique.
		let dimension = f32( ${ bounceIndex } * ${ EFFECTS_PER_BOUNCE }u + effect );
		let dimensionVector = 4.0 * dimension + vec4f( 0.0, 1.0, 2.0, 3.0 );
		let rotationVector = dimensionVector * ${ GOLDEN_RATIO_FRACT };

		// Get the scrambled sobol stratified sample
		let stratifiedSample = ${ rand4 }( effect );

		// offset it by the blue noise seed and dimension rotation
		return fract( stratifiedSample + ${ pixelSeed }.r + rotationVector );

	}
`;

const blueDitherRand3Func = wgslTagFn/* wgsl */`
	fn blueDitherRand3( effect: u32 ) -> vec3f {

		return ${ blueDitherRand4Func }( effect ).xyz;

	}
`;

const blueDitherRand2Func = wgslTagFn/* wgsl */`
	fn blueDitherRand2( effect: u32 ) -> vec2f {

		return ${ blueDitherRand4Func }( effect ).xy;

	}
`;

const blueDitherRand1Func = wgslTagFn/* wgsl */`
	fn blueDitherRand1( effect: u32 ) -> f32 {

		return ${ blueDitherRand4Func }( effect ).x;

	}
`;

export {
	blueDitherNextBounceFunc as rngNextBounce,
	blueDitherInitFunc as rngInit,
	blueDitherRand1Func as rand1,
	blueDitherRand2Func as rand2,
	blueDitherRand3Func as rand3,
	blueDitherRand4Func as rand4,
};
