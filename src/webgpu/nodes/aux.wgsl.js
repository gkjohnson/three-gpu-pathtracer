import { wgslFn } from 'three/tsl';

// The denoiser's auxiliary images, the first hit albedo and normal, accumulate in an "r32uint" array
// texture, the one kind of storage texture core WebGPU can both read and write. Each layer packs two
// halves: albedo.rg, then albedo.b and normal.z, then normal.xy.
export const AUX_LAYERS = 3;

// The packing as WGSL source, shared with the denoiser's own unpack pass
export const PACK_AUX_WGSL = /* wgsl */`
	fn packAux( albedo: vec3f, normal: vec3f ) -> vec3u {

		return vec3u(
			pack2x16float( albedo.rg ),
			pack2x16float( vec2f( albedo.b, normal.z ) ),
			pack2x16float( normal.xy ),
		);

	}
`;

export const UNPACK_AUX_ALBEDO_WGSL = /* wgsl */`
	fn unpackAuxAlbedo( packed: vec3u ) -> vec3f {

		return vec3f( unpack2x16float( packed.x ), unpack2x16float( packed.y ).x );

	}
`;

export const UNPACK_AUX_NORMAL_WGSL = /* wgsl */`
	fn unpackAuxNormal( packed: vec3u ) -> vec3f {

		return vec3f( unpack2x16float( packed.z ), unpack2x16float( packed.y ).y );

	}
`;

export const packAuxFn = wgslFn( PACK_AUX_WGSL );
export const unpackAuxAlbedoFn = wgslFn( UNPACK_AUX_ALBEDO_WGSL );
export const unpackAuxNormalFn = wgslFn( UNPACK_AUX_NORMAL_WGSL );
