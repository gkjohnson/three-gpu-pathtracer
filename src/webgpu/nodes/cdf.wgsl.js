import { wgslTagFn } from 'three-mesh-bvh/webgpu';

// the entry at "i" of the CDFs in an "EnvironmentCdfTexture"
export const readCdfFn = wgslTagFn/* wgsl */`
	fn readCdf( cdf: texture_2d<f32>, i: u32 ) -> f32 {

		let width = textureDimensions( cdf ).x;
		return textureLoad( cdf, vec2u( i % width, i / width ), 0 ).r;

	}
`;

// Binary searches the "count" ranges of a CDF from "offset", each two neighboring entries, for the one holding "r",
// writing where "r" falls within it to "fraction". See:
// https://pbr-book.org/3ed-2018/Monte_Carlo_Integration/2D_Sampling_with_Multidimensional_Transformations#Piecewise-Constant2DDistributions
// https://github.com/blender/cycles/blob/main/src/kernel/light/background.h
export const searchCdfFn = wgslTagFn/* wgsl */`
	fn searchCdf( cdf: texture_2d<f32>, r: f32, offset: u32, count: u32, fraction: ptr<function, f32> ) -> u32 {

		var lower = 0u;
		var upper = count - 1u;
		while ( lower < upper ) {

			let mid = ( lower + upper ) >> 1u;
			if ( ${ readCdfFn }( cdf, offset + mid + 1u ) <= r ) {

				lower = mid + 1u;

			} else {

				upper = mid;

			}

		}

		let start = ${ readCdfFn }( cdf, offset + lower );
		let end = ${ readCdfFn }( cdf, offset + lower + 1u );
		*fraction = select( 0.5, saturate( ( r - start ) / ( end - start ) ), end > start );
		return lower;

	}
`;
