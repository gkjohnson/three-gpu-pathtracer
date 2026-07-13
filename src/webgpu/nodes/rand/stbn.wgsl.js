import { texture, uniform, uvec2, uint } from 'three/tsl';
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
export const MAX_STBN_SLOTS = 512;

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
		console.log( data.length, STBN_SIZE * STBN_SIZE * STBN_DEPTH )

		tex.image = { data, width: STBN_SIZE, height: STBN_SIZE, depth: STBN_DEPTH };
		tex.needsUpdate = true;

	}

	console.log(
		new URL( '../../textures/stbn_scalar_128x128x64.bin', import.meta.url ).toString(),
	)
	await Promise.all( [
		loadMask( _stbnScalarTexture, new URL( '../../textures/stbn_vec1_128x128x64.bin', import.meta.url ) ),
		loadMask( _stbnVec2Texture, new URL( '../../textures/stbn_vec2_128x128x64.bin', import.meta.url ) ),
		loadMask( _stbnVec3Texture, new URL( '../../textures/stbn_vec3_128x128x64.bin', import.meta.url ) ),
	] );

} catch ( error ) {

	console.warn( 'blueNoise.wgsl.js: failed to load blue noise masks, falling back to white noise.', error );

}


// runtime toggle shared by every kernel
const _blueNoiseEnabled = uniform( 1 );
export function setBlueNoiseEnabled( enabled ) {

	_blueNoiseEnabled.value = enabled ? 1 : 0;

}



const pixelIndex = uvec2( 0 ).toVar( 'sobolPixelIndex' );
const pathIndex = uint( 0 ).toVar( 'sobolPathIndex' );
const bounceIndex = uint( 0 ).toVar( 'sobolBounceIndex' );

const stbnInitFunc = wgslTagFn/* wgsl */`
	fn stbnInitialize( pixel: vec2u, pathIndex: u32, bounceIndex: u32 ) -> void {

		${ pixelIndex } = pixel;
		${ pathIndex } = pathIndex;
		${ bounceIndex } = bounceIndex;

		${ rngInit }( pixel, pathIndex, bounceIndex );

	}
`;

const stbnNextBounceFunc = wgslTagFn/* wgsl */`
	fn stbnNextBounce() -> void {

		${ bounceIndex }++;
		${ rngNextBounce }();

	}
`;

const loadSTBNFunc = wgslTagFn/* wgsl */`
	fn loadSTBN( pixel: vec2u, slice: u32, dim: u32 ) -> vec4f {

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
`

const stbnRand4Func = wgslTagFn/* wgsl */`
	fn stbnRand4( effect: u32 ) -> vec4f {

		if ( ${ pathIndex } > ${ STBN_DEPTH } ) {

			return ${ rand4 }( effect );

		} else {

			return ${ loadSTBNFunc }( ${ pixelIndex }, ${ pathIndex }, 0u );

		}
		return vec4f( 0.0 );

	}
`;

const stbnRand3Func = wgslTagFn/* wgsl */`
	fn stbnRand3( effect: u32 ) -> vec3f {

		return ${ stbnRand4Func }( effect ).xyz;

	}
`;

const stbnRand2Func = wgslTagFn/* wgsl */`
	fn stbnRand2( effect: u32 ) -> vec2f {

		return ${ stbnRand4Func }( effect ).xy;

	}
`;

const stbnRand1Func = wgslTagFn/* wgsl */`
	fn stbnRand1( effect: u32 ) -> f32 {

		return ${ stbnRand4Func }( effect ).x;

	}
`;


export {
	stbnInitFunc as rngInit,
	stbnNextBounceFunc as rngNextBounce,
	stbnRand1Func as rand1,
	stbnRand2Func as rand2,
	stbnRand3Func as rand3,
	stbnRand4Func as rand4,
};
