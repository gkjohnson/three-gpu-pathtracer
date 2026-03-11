import { wgslFn } from 'three/tsl';

export const unpackCompensationFn = wgslFn( /* wgsl */`
	fn unpackCompensation( packed: u32, color: vec4f ) -> vec4f {

		// FP16 has 10 mantissa bits so 2^-10 * 0.5 = 2^-11 = 1 / 2048 relative rounding error
		// 127 maps the value to a signed 8 bit range
		const COMP_SCALE = 127.0 * 2048.0;
		let raw = vec4f(
			f32( ( packed >> 0u ) & 0xFFu ),
			f32( ( packed >> 8u ) & 0xFFu ),
			f32( ( packed >> 16u ) & 0xFFu ),
			f32( ( packed >> 24u ) & 0xFFu )
		) - 128.0;

		// scale the value by the input color to accommodate relative error differences
		return ( raw / COMP_SCALE ) * color;

	}
` );

export const packCompensationFn = wgslFn( /* wgsl */`
	fn packCompensation( compensation: vec4f, color: vec4f ) -> u32 {

		const COMP_SCALE = 127.0 * 2048.0;

		// avoid divide by zero
		let safeScale = select( color, vec4f( 1.0 ), color == vec4f( 0.0 ) );

		// undo the above packing calculation, clamping to be safe
		var quantized = ( compensation / safeScale ) * COMP_SCALE + 128.0;
		quantized = clamp( quantized, vec4f( 0.0 ), vec4f( 255.0 ) );

		// pack all the channels
		return u32(
			( u32( quantized.r ) << 0u ) |
			( u32( quantized.g ) << 8u ) |
			( u32( quantized.b ) << 16u ) |
			( u32( quantized.a ) << 24u )
		);

	}
` );
