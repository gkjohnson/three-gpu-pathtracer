import { texture, uniform, uvec2, uint, uvec4, vec4 } from 'three/tsl';
import { DataArrayTexture, RedFormat, RGFormat, RGBAFormat, UnsignedByteType, NearestFilter, RepeatWrapping } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rand1, rand2, rand3, rand4, rngInit, rngNextBounce } from './sobol.wgsl.js';

// initialize the textures
function createMaskTexture( format ) {

	const tex = new DataArrayTexture();
	tex.format = format;
	tex.type = UnsignedByteType;
	tex.minFilter = NearestFilter;
	tex.magFilter = NearestFilter;
	tex.wrapS = RepeatWrapping;
	tex.wrapT = RepeatWrapping;
	return tex;

}

// hard code dimensions of the texture
export const STBN_SIZE = 128;
export const STBN_DEPTH = 64;

const _stbnScalarTexture = createMaskTexture( RedFormat );
const _stbnVec2Texture = createMaskTexture( RGFormat );
const _stbnVec3Texture = createMaskTexture( RGBAFormat );

const _stbnScalarNode = texture( _stbnScalarTexture );
const _stbnVec2Node = texture( _stbnVec2Texture );
const _stbnVec3Node = texture( _stbnVec3Texture );

// load textures
try {

	async function loadMask( tex, url ) {

		const data = new Uint8Array( await fetch( url ).then( res => res.arrayBuffer() ) );
		tex.image = { data, width: STBN_SIZE, height: STBN_SIZE, depth: STBN_DEPTH };
		tex.needsUpdate = true;

	}

	await Promise.all( [
		loadMask( _stbnScalarTexture, new URL( '../../textures/stbn_vec1_128x128x64.bin', import.meta.url ) ),
		loadMask( _stbnVec2Texture, new URL( '../../textures/stbn_vec2_128x128x64.bin', import.meta.url ) ),
		loadMask( _stbnVec3Texture, new URL( '../../textures/stbn_vec3_128x128x64.bin', import.meta.url ) ),
	] );

} catch ( error ) {

	console.warn( 'bluedither.wgsl.js: failed to load blue noise masks, falling back to per-pixel sobol.', error );

}

const readSTBNFunc = wgslTagFn/* wgsl */`
	fn readSTBN( pixel: vec2u, slice: u32, dim: u32 ) -> vec4f {

		let coord = vec2i( pixel % vec2u( ${ STBN_SIZE }u ) );
		let sliceMod = i32( slice % ${ STBN_DEPTH }u );

		if ( dim == 1u ) {

			return textureLoad( ${ _stbnScalarNode }, coord, sliceMod, 0 );

		} else if ( dim == 2u ) {

			return textureLoad( ${ _stbnVec2Node }, coord, sliceMod, 0 );

		} else if ( dim == 3u ) {

			return textureLoad( ${ _stbnVec3Node }, coord, sliceMod, 0 );

		} else {

			return vec4(
				textureLoad( ${ _stbnVec3Node }, coord, sliceMod, 0 ).xyz,
				textureLoad( ${ _stbnScalarNode }, coord, sliceMod, 0 ).x,
			);

		}

	}
`;

const pixelIndex = uvec2( 0 ).toVar( 'blueDitherPixelIndex' );
const bounceIndex = uint( 0 ).toVar( 'blueDitherBounceIndex' );
const pixelSeed = vec4( 0 ).toVar( 'blueDitherSeed' );

// When dithering, the sobol sampler is seeded with a constant pixel so every pixel
// draws the same sequence; when disabled it falls back to per-pixel sequences.
const blueDitherInitFunc = wgslTagFn/* wgsl */`
	fn blueDitherInitialize( pixel: vec2u, pathIndex: u32, bounceIndex: u32 ) -> void {

		${ pixelSeed } = ${ readSTBNFunc }( pixel, 0u, 4u );
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

const blueDitherRand4Func = wgslTagFn/* wgsl */`
	fn blueDitherRand4( effect: u32 ) -> vec4f {

		let stratifiedSample = ${ rand4 }( effect );
		return fract( stratifiedSample + ${ pixelSeed }.r );

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
	blueDitherInitFunc as rngInit,
	blueDitherNextBounceFunc as rngNextBounce,
	blueDitherRand1Func as rand1,
	blueDitherRand2Func as rand2,
	blueDitherRand3Func as rand3,
	blueDitherRand4Func as rand4,
};
