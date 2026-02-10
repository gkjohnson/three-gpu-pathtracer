import { wgsl, wgslFn } from 'three/tsl';

export const pcgStateStruct = wgsl( /* wgsl */`
	struct PcgState {
		s0: vec4u,
		s1: vec4u,
		pixel: vec2i,
	};

	var<private> g_state: PcgState;
` );

export const pcgInit = wgslFn( /* wgsl */`
	fn pcgInitialize(p: vec2u, frame: u32) -> void {
		g_state.pixel = vec2i( p );

		//white noise seed
		g_state.s0 = vec4u(p, frame, u32(p.x) + u32(p.y));

		//blue noise seed
		g_state.s1 = vec4u(frame, frame*15843, frame*31 + 4566, frame*2345 + 58585);
	}
`, [ pcgStateStruct ] );

export const pcg4d = wgslFn( /* wgsl */ `
	fn pcg4d(v: ptr<private, vec4u>) -> void {
		*v = *v * 1664525u + 1013904223u;
		v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
		*v = *v ^ (*v >> vec4u(16u));
		v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
	}
` );

// TODO: test if abs there is necessary
export const pcgRand3 = wgslFn( /*wgsl*/`
	fn pcgRand3() -> vec3f {
		pcg4d(&g_state.s0);
		return abs( vec3f(g_state.s0.xyz) / f32(0xffffffffu) );
	}
`, [ pcg4d, pcgStateStruct ] );

export const pcgRand2 = wgslFn( /*wgsl*/`
	fn pcgRand2() -> vec2f {
		pcg4d(&g_state.s0);
		return abs( vec2f(g_state.s0.xy) / f32(0xffffffffu) );
	}
`, [ pcg4d, pcgStateStruct ] );

export const pcgRand = wgslFn( /*wgsl*/`
	fn pcgRand() -> f32 {
		pcg4d(&g_state.s0);
		return abs( f32( g_state.s0.x ) / f32(0xffffffffu) );
	}
`, [ pcg4d, pcgStateStruct ] );
