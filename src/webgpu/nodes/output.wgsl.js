import { wgslFn } from 'three/tsl';

// read and write a color of the output target, which stores a channel per layer. See "createOutputTarget"
export const loadOutputFn = wgslFn( /* wgsl */`
	fn loadOutput( outputTarget: texture_storage_2d_array<r32float, read_write>, pixel: vec2u ) -> vec4f {

		return vec4f(
			textureLoad( outputTarget, pixel, 0 ).r,
			textureLoad( outputTarget, pixel, 1 ).r,
			textureLoad( outputTarget, pixel, 2 ).r,
			textureLoad( outputTarget, pixel, 3 ).r,
		);

	}
` );

export const storeOutputFn = wgslFn( /* wgsl */`
	fn storeOutput( outputTarget: texture_storage_2d_array<r32float, read_write>, pixel: vec2u, color: vec4f ) -> void {

		textureStore( outputTarget, pixel, 0, vec4f( color.r ) );
		textureStore( outputTarget, pixel, 1, vec4f( color.g ) );
		textureStore( outputTarget, pixel, 2, vec4f( color.b ) );
		textureStore( outputTarget, pixel, 3, vec4f( color.a ) );

	}
` );
