import { wgsl, wgslFn } from 'three/tsl';

const pcgStateStruct = wgsl( /* wgsl */`

	struct PcgState {
		s0: vec4u,
		s1: vec4u,
	};

	var<private> g_state: PcgState;
` );

const pcgInitFunc = wgslFn( /* wgsl */`
	fn pcgInitialize( pixel: vec2u, pathIndex: u32, bounceIndex: u32 ) -> void {

		// white noise seed
		g_state.s0 = vec4u( pixel | vec2( bounceIndex << 16 ), pathIndex, pixel.x + pixel.y);

		// blue noise seed
		g_state.s1 = vec4u( pathIndex, pathIndex * 15843, pathIndex * 31 + 4566, pathIndex * 2345 + 58585 );

	}
`, [ pcgStateStruct ] );

const pcg4d = wgslFn( /* wgsl */ `
	fn pcg4d( v: ptr<private, vec4u> ) -> void {

		*v = *v * 1664525u + 1013904223u;
		*v = *v + v.yzxy * v.wxyz;
		*v = *v ^ ( *v >> vec4u( 16u ) );
		*v = *v + v.yzxy * v.wxyz;
	}
` );

const pcgRandFunc = wgslFn( /*wgsl*/`
	fn pcgRand( _id: u32 ) -> f32 {

		pcg4d( &g_state.s0 );
		return abs( f32( g_state.s0.x ) / f32( 0xffffffffu ) );

	}
`, [ pcg4d, pcgStateStruct ] );

const pcgRand2Func = wgslFn( /*wgsl*/`
	fn pcgRand2( _id: u32 ) -> vec2f {

		pcg4d( &g_state.s0 );
		return abs( vec2f( g_state.s0.xy ) / f32( 0xffffffffu ) );

	}
`, [ pcg4d, pcgStateStruct ] );

const pcgRand3Func = wgslFn( /*wgsl*/`
	fn pcgRand3( _id: u32 ) -> vec3f {

		pcg4d( &g_state.s0 );
		return abs( vec3f( g_state.s0.xyz ) / f32( 0xffffffffu ) );

	}
`, [ pcg4d, pcgStateStruct ] );

const pcgRand4Func = wgslFn( /*wgsl*/`
	fn pcgRand4( _id: u32 ) -> vec4f {

		pcg4d( &g_state.s0 );
		return abs( vec4f( g_state.s0 ) / f32( 0xffffffffu ) );

	}
`, [ pcg4d, pcgStateStruct ] );

const pcgNextBounceFunc = wgslFn( /* wgsl */ 'fn noop() -> void {}' );

// PCG definitions
export {
	pcgInitFunc as rngInit,
	pcgNextBounceFunc as rngNextBounce,
	pcgRandFunc as rand1,
	pcgRand2Func as rand2,
	pcgRand3Func as rand3,
	pcgRand4Func as rand4,
};
