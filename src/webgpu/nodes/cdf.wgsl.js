import { PI } from 'three/tsl';
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

// Bilinear filtering blends the four nearest texels, so the environment's filtered radiance is a grid of "patches",
// one between each four neighboring texel centers, with the radiance varying bilinearly across each. Patches are
// sampled in proportion to their bilinear luminance, as Mitsuba 3's environment emitter does, so the sampling matches
// the filtered radiance. See "Sampling the Bilinear Function" in
// https://pbr-book.org/4ed/Monte_Carlo_Integration/Transforming_between_Distributions
// and https://github.com/mitsuba-renderer/mitsuba3/blob/master/src/emitters/envmap.cpp
//
// A "width" x "height" map has "width" columns and "height + 1" rows of patches:
// - Column "x" spans from texel center "x" to texel center "x + 1". The map wraps horizontally, so the last column
//   spans the seam back to texel center 0.
// - Row "y" spans from texel center "y - 1" to texel center "y". The map is clamped vertically, so the first and last
//   rows are half a texel tall, running from the pole to the nearest texel center.
// A corner's sampling weight is the luminance there times the sine of its polar angle, which the solid angle a texel
// covers is proportional to.

// the vertical position, in texels from the top of the map, where patch row "row" starts: the top pole for the first
// row and texel center "row - 1" for the rest. Row "row + 1" gives where it ends, the bottom pole for the last row
export const getEnvPatchRowStartFn = wgslTagFn/* wgsl */`
	fn getEnvPatchRowStart( map: texture_2d<f32>, row: u32 ) -> f32 {

		let height = f32( textureDimensions( map ).y );
		return clamp( f32( row ) - 0.5, 0.0, height );

	}
`;

// the sampling weight at the top left corner of the patch in column "x" and row "row", from the texel at that corner,
// or the nearest texel row at the poles
const getEnvCornerWeightFn = wgslTagFn/* wgsl */`
	fn getEnvCornerWeight( map: texture_2d<f32>, x: u32, row: u32 ) -> f32 {

		let size = textureDimensions( map );
		let texel = vec2u( x % size.x, u32( clamp( i32( row ) - 1, 0, i32( size.y ) - 1 ) ) );
		let luminance = dot( textureLoad( map, texel, 0 ).rgb, vec3f( 0.2126, 0.7152, 0.0722 ) );
		return luminance * sin( ${ PI } * ${ getEnvPatchRowStartFn }( map, row ) / f32( size.y ) );

	}
`;

// the sampling weights at the four corners of the patch in column "cell.x" and row "cell.y", ordered top left,
// top right, bottom left, bottom right
export const getEnvPatchCornersFn = wgslTagFn/* wgsl */`
	fn getEnvPatchCorners( map: texture_2d<f32>, cell: vec2u ) -> vec4f {

		return vec4f(
			${ getEnvCornerWeightFn }( map, cell.x, cell.y ),
			${ getEnvCornerWeightFn }( map, cell.x + 1u, cell.y ),
			${ getEnvCornerWeightFn }( map, cell.x, cell.y + 1u ),
			${ getEnvCornerWeightFn }( map, cell.x + 1u, cell.y + 1u ),
		);

	}
`;
