import { float, texture } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rand4, rngInit, rngNextBounce } from './sobol.wgsl.js';
import { BlueNoiseTexture } from '../../../textures/BlueNoiseTexture.js';

// construct the blue noise texture
const STBN_SIZE = 64;
const bnTex = new BlueNoiseTexture( STBN_SIZE, 1 );
const texNode = texture( bnTex );
const pixelSeed = float( 0 ).toVar( 'blueDitherSeed' );

// When dithering, the sobol sampler is seeded with a constant pixel so every pixel
// uses the same sequence, which is modified with the per-pixel blue noise sample.
const blueDitherInitFunc = wgslTagFn/* wgsl */`
	fn blueDitherInitialize( pixel: vec2u, pathIndex: u32, bounceIndex: u32 ) -> void {

		let coord = vec2i( pixel % vec2u( ${ STBN_SIZE }u ) );
		${ pixelSeed } = textureLoad( ${ texNode }, coord, 0 ).r;
		${ rngInit }( vec2u( 0 ), pathIndex, bounceIndex );

	}
`;

const blueDitherRand4Func = wgslTagFn/* wgsl */`
	fn blueDitherRand4( effect: u32 ) -> vec4f {

		let stratifiedSample = ${ rand4 }( effect );
		return fract( stratifiedSample + ${ pixelSeed } );

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
	// bounce increment is sobol pass through
	rngNextBounce as rngNextBounce,

	blueDitherInitFunc as rngInit,
	blueDitherRand1Func as rand1,
	blueDitherRand2Func as rand2,
	blueDitherRand3Func as rand3,
	blueDitherRand4Func as rand4,
};
