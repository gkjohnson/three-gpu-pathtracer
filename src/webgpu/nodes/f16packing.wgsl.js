import { wgslFn } from 'three/tsl';

export const unpackCompensationFn = wgslFn( /* wgsl */`
	fn unpackCompensation( packed: u32, color: vec4f ) -> vec4f {

		// FP16 has 10 mantissa bits so 2^-10 * 0.5 = 2^-11 = 1 / 2048 relative rounding error
		// 127 maps the value to a signed 8 bit range
		const UNPACK_FACTOR = 1.0 / ( 127.0 * 2048.0 );
		let quantized = vec4f(
			f32( ( packed >> 0u ) & 0xFFu ),
			f32( ( packed >> 8u ) & 0xFFu ),
			f32( ( packed >> 16u ) & 0xFFu ),
			f32( ( packed >> 24u ) & 0xFFu )
		) - 128.0;

		// scale the value by the input color to accommodate relative error differences
		return UNPACK_FACTOR * quantized * color;

	}
` );

export const packCompensationFn = wgslFn( /* wgsl */`
	fn packCompensation( compensation: vec4f, color: vec4f ) -> u32 {

		// see above UNPACK_FACTOR comment
		const PACK_FACTOR = 127.0 * 2048.0;

		// avoid divide by zero
		// note that select operates component-wise
		let safeColor = select( color, vec4f( 1.0 ), color == vec4f( 0.0 ) );

		// undo the above packing calculation, clamping to be safe
		var quantized = vec4u( PACK_FACTOR * compensation / safeColor ) + 128u;
		quantized = clamp( quantized, vec4u( 0 ), vec4u( 255 ) );

		// pack all the channels
		return (
			( quantized.r << 0u ) |
			( quantized.g << 8u ) |
			( quantized.b << 16u ) |
			( quantized.a << 24u )
		);

	}
` );
