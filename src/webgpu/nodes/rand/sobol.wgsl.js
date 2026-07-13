import { uint, float, wgsl, wgslFn } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

// References
// - https://jcgt.org/published/0009/04/01/
// - Code from https://www.shadertoy.com/view/WtGyDm
// Ported from WebGL version at sobol.glsl.js

const SOBOL_MAX_POINTS = uint( 256 * 256 );
const SOBOL_FACTOR = float( 1.0 / 16777216.0 );

const sobolConstants = wgsl( /* wgsl */ `

	const SOBOL_DIRECTIONS_1 = array<u32, 32>(
		0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u,
		0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
		0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u,
		0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
		0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u,
		0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
		0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u,
		0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu
	);

	const SOBOL_DIRECTIONS_2 = array<u32, 32>(
		0x80000000u, 0xc0000000u, 0x60000000u, 0x90000000u,
		0xe8000000u, 0x5c000000u, 0x8e000000u, 0xc5000000u,
		0x68800000u, 0x9cc00000u, 0xee600000u, 0x55900000u,
		0x80680000u, 0xc09c0000u, 0x60ee0000u, 0x90550000u,
		0xe8808000u, 0x5cc0c000u, 0x8e606000u, 0xc5909000u,
		0x6868e800u, 0x9c9c5c00u, 0xeeee8e00u, 0x5555c500u,
		0x8000e880u, 0xc0005cc0u, 0x60008e60u, 0x9000c590u,
		0xe8006868u, 0x5c009c9cu, 0x8e00eeeeu, 0xc5005555u
	);

	const SOBOL_DIRECTIONS_3 = array<u32, 32>(
		0x80000000u, 0xc0000000u, 0x20000000u, 0x50000000u,
		0xf8000000u, 0x74000000u, 0xa2000000u, 0x93000000u,
		0xd8800000u, 0x25400000u, 0x59e00000u, 0xe6d00000u,
		0x78080000u, 0xb40c0000u, 0x82020000u, 0xc3050000u,
		0x208f8000u, 0x51474000u, 0xfbea2000u, 0x75d93000u,
		0xa0858800u, 0x914e5400u, 0xdbe79e00u, 0x25db6d00u,
		0x58800080u, 0xe54000c0u, 0x79e00020u, 0xb6d00050u,
		0x800800f8u, 0xc00c0074u, 0x200200a2u, 0x50050093u
	);

	const SOBOL_DIRECTIONS_4 = array<u32, 32>(
		0x80000000u, 0x40000000u, 0x20000000u, 0xb0000000u,
		0xf8000000u, 0xdc000000u, 0x7a000000u, 0x9d000000u,
		0x5a800000u, 0x2fc00000u, 0xa1600000u, 0xf0b00000u,
		0xda880000u, 0x6fc40000u, 0x81620000u, 0x40bb0000u,
		0x22878000u, 0xb3c9c000u, 0xfb65a000u, 0xddb2d000u,
		0x78022800u, 0x9c0b3c00u, 0x5a0fb600u, 0x2d0ddb00u,
		0xa2878080u, 0xf3c9c040u, 0xdb65a020u, 0x6db2d0b0u,
		0x800228f8u, 0x400b3cdcu, 0x200fb67au, 0xb00ddb9du
	);

` );

const sobolPixelIndex = uint( 0 ).toVar( 'sobolPixelIndex' );
const sobolPathIndex = uint( 0 ).toVar( 'sobolPathIndex' );
const sobolBounceIndex = uint( 0 ).toVar( 'sobolBounceIndex' );

const getMaskedSobolFunc = wgslFn( /* wgsl */ `

	fn getMaskedSobol( index: u32, directions: array<u32, 32> ) -> u32 {

		var X = 0u;
		for ( var bit = 0u; bit < 32u; bit ++ ) {

			let mask = ( index >> bit ) & 1u;
			X ^= mask * directions[ bit ];

		}
		return X;

	}

` );

// functions to generate multi-dimensions variables of the same functions
// to support 1, 2, 3, and 4 dimensional sobol sampling.
const sobolScrambleNodesGenerator = ( dim = 1 ) => {

	if ( dim <= 0 ) {

		return;

	}

	const type = dim > 1 ? `vec${dim}u` : 'u32';

	const sobolReverseBitsFunc = wgslFn( /* wgsl */ `

			fn sobolReverseBits_${type}( in: ${type} ) -> ${type} {

				var x = in;
				x = ( ( ( x & ${type}( 0xaaaaaaaau ) ) >> ${type}( 1 ) ) | ( ( x & ${type}( 0x55555555u ) ) << ${type}( 1 ) ) );
				x = ( ( ( x & ${type}( 0xccccccccu ) ) >> ${type}( 2 ) ) | ( ( x & ${type}( 0x33333333u ) ) << ${type}( 2 ) ) );
				x = ( ( ( x & ${type}( 0xf0f0f0f0u ) ) >> ${type}( 4 ) ) | ( ( x & ${type}( 0x0f0f0f0fu ) ) << ${type}( 4 ) ) );
				x = ( ( ( x & ${type}( 0xff00ff00u ) ) >> ${type}( 8 ) ) | ( ( x & ${type}( 0x00ff00ffu ) ) << ${type}( 8 ) ) );
				return ( ( x >> ${type}( 16 ) ) | ( x << ${type}( 16 ) ) );

			}

	` );

	const sobolHashCombineFunc = wgslFn( /* wgsl */ `

		fn sobolHashCombine_${type}( seed: u32, v: ${type} ) -> ${type} {

			return ${type}( seed ) ^ ( v + ${ type }( ( seed << 6 ) + ( seed >> 2 ) ) );

		}

	` );

	const sobolLaineKarrasPermutationFunc = wgslFn( /* wgsl */ `

		fn sobolLaineKarrasPermutation_${type}( in: ${type}, seed: ${type} ) -> ${type} {

			var x = in;
			x += seed;
			x ^= x * 0x6c50b47cu;
			x ^= x * 0xb82f1e52u;
			x ^= x * 0xc7afe638u;
			x ^= x * 0x8d22f6e6u;
			return x;

		}

	` );

	const nestedUniformScrambleBase2Func = wgslTagFn/* wgsl */ `

		fn nestedUniformScrambleBase2_${type}( x: ${type}, seed: ${type} ) -> ${type} {

			var res = ${ sobolLaineKarrasPermutationFunc }( x, seed );
			res = ${ sobolReverseBitsFunc }( res );
			return res;

		}

	`;

	return {
		reverseBits: sobolReverseBitsFunc,
		hashCombine: sobolHashCombineFunc,
		lkPermutation: sobolLaineKarrasPermutationFunc,
		scramble: nestedUniformScrambleBase2Func,
	};

};

// 0th node is intentionally empty to make access pattern more intuitive:
// sobolNodes[ i ] are nodes that are needed to sample i-dimensional vectors
// 1-dimensional vector = f32
const sobolNodes = Array.from( { length: 5 }, ( _, i ) => sobolScrambleNodesGenerator( i ) );

const generateSobolPointFunc = wgslTagFn`
  ${ [ sobolConstants ] }

	fn generateSobolPoint( id: u32 ) -> vec4f {

		var index = id;
		if ( index >= ${ SOBOL_MAX_POINTS } ) {

			index = index % ${ SOBOL_MAX_POINTS };
			// return vec4( 0.0 );

		}

		// NOTE: this sobol "direction" is also available but we can't write out 5 components
		// uint x = index & 0x00ffffffu;
		let x = ${ sobolNodes[ 1 ].reverseBits }( ${ getMaskedSobolFunc }( index, SOBOL_DIRECTIONS_1 ) ) & 0x00ffffffu;
		let y = ${ sobolNodes[ 1 ].reverseBits }( ${ getMaskedSobolFunc }( index, SOBOL_DIRECTIONS_2 ) ) & 0x00ffffffu;
		let z = ${ sobolNodes[ 1 ].reverseBits }( ${ getMaskedSobolFunc }( index, SOBOL_DIRECTIONS_3 ) ) & 0x00ffffffu;
		let w = ${ sobolNodes[ 1 ].reverseBits }( ${ getMaskedSobolFunc }( index, SOBOL_DIRECTIONS_4 ) ) & 0x00ffffffu;

		return vec4( f32( x ), f32( y ), f32( z ), f32( w ) ) * ${ SOBOL_FACTOR };

	}

`;

const sobolHashFunc = wgslFn( /* wgsl */ `

	fn sobolHash( in: u32 ) -> u32 {

		var x = in;
		// finalizer from murmurhash3
		x ^= x >> 16;
		x *= 0x85ebca6bu;
		x ^= x >> 13;
		x *= 0xc2b2ae35u;
		x ^= x >> 16;
		return x;

	}

` );

const sobolGetSeedFunc = wgslTagFn/* wgsl */`

	fn sobolGetSeed( effect: u32 ) -> u32 {

		return ${ sobolHashFunc }(
			${ sobolNodes[ 1 ].hashCombine }(
				${ sobolNodes[ 1 ].hashCombine }(
					${ sobolHashFunc }( ${ sobolBounceIndex } ),
					${ sobolPixelIndex }
				),
				effect
			)
		);

	}

`;

const sobolGenerator = ( dim = 1, sobolPointFunc = generateSobolPointFunc ) => {

	if ( dim <= 0 ) {

		return;

	}

	const utype = dim > 1 ? `vec${ dim }u` : 'u32';
	const ftype = dim > 1 ? `vec${ dim }f` : 'f32';

	let components = '.r';
	let combineValues = '1u';
	if ( dim === 2 ) {

		components = '.rg';
		combineValues = 'vec2( 1u, 2u )';

	} else if ( dim === 3 ) {

		components = '.rgb';
		combineValues = 'vec3( 1u, 2u, 3u )';

	} else if ( dim === 4 ) {

		components = '';
		combineValues = 'vec4( 1u, 2u, 3u, 4u )';

	}

	return wgslTagFn/* wgsl */`

		fn sobol${ dim }( effect: u32 ) -> ${ ftype } {

			let seed = ${ sobolGetSeedFunc }( effect );
			let index = ${ sobolPathIndex };

			let shuffle_seed = ${ sobolNodes[ 1 ].hashCombine }( seed, 0u );
			let shuffled_index = ${ sobolNodes[ 1 ].scramble }( ${ sobolNodes[ 1 ].reverseBits }( index ), shuffle_seed );
			let sobol_pt = ${ sobolPointFunc }( shuffled_index )${ components };
			var result = ${ utype }( sobol_pt * 16777216.0 );

			let seed2 = ${ sobolNodes[ dim ].hashCombine }( seed, ${ combineValues } );
			result = ${ sobolNodes[ dim ].scramble }( result, seed2 );

			return ${ SOBOL_FACTOR } * ${ ftype }( result >> ${utype}( 8 ) );

		}

	`;

};

const sobolRand1Func = sobolGenerator( 1 );
const sobolRand2Func = sobolGenerator( 2 );
const sobolRand3Func = sobolGenerator( 3 );
const sobolRand4Func = sobolGenerator( 4 );

const sobolInitFunc = wgslTagFn/* wgsl */`

	fn sobolInit( pixelIndex: u32, pathIndex: u32, bounceIndex: u32 ) -> void {

		${ sobolPixelIndex } = pixelIndex;
		${ sobolPathIndex } = pathIndex;
		${ sobolBounceIndex } = bounceIndex;

	}

`;

const sobolNextBounceFunc = wgslTagFn/* wgsl */`

	fn sobolNextBounce() -> void {

		${ sobolBounceIndex }++;

	}

`;

// Sobol definitions
export {
	sobolInitFunc as rngInit,
	sobolNextBounceFunc as rngNextBounce,
	sobolRand1Func as rand1,
	sobolRand2Func as rand2,
	sobolRand3Func as rand3,
	sobolRand4Func as rand4,
};
