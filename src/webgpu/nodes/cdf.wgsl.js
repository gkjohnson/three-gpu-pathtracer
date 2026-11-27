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

// The environment is read with bilinear filtering, which makes its radiance a grid of bilinear patches between texel
// centers. Each patch is sampled in proportion to its bilinear luminance, as Mitsuba 3's environment emitter does, so
// the sampling matches the filtered radiance. See "Sampling the Bilinear Function" in
// https://pbr-book.org/4ed/Monte_Carlo_Integration/Transforming_between_Distributions
// and https://github.com/mitsuba-renderer/mitsuba3/blob/master/src/emitters/envmap.cpp
//
// The map wraps around horizontally and is clamped at the poles, as the path tracer's environment cache sets it, so
// patch "x" spans from texel center "x" to the next one, across the seam for the last, and the rows of patches are
// half height at the poles where the filter clamps. Patch corners are texel centers, and the sampling weight there is
// the luminance times the sine of its angle, the solid angle it covers.

// the texel position of the patch row edge "k": the poles, and the texel centers between them
export const getEnvRowEdgeFn = wgslTagFn/* wgsl */`
	fn getEnvRowEdge( map: texture_2d<f32>, k: u32 ) -> f32 {

		let height = f32( textureDimensions( map ).y );
		return clamp( f32( k ) - 0.5, 0.0, height );

	}
`;

// the sampling weight at the corner in column "x" on the row edge "k"
const getEnvCornerWeightFn = wgslTagFn/* wgsl */`
	fn getEnvCornerWeight( map: texture_2d<f32>, x: u32, k: u32 ) -> f32 {

		let size = textureDimensions( map );
		let texel = vec2u( x % size.x, u32( clamp( i32( k ) - 1, 0, i32( size.y ) - 1 ) ) );
		let luminance = dot( textureLoad( map, texel, 0 ).rgb, vec3f( 0.2126, 0.7152, 0.0722 ) );
		return luminance * sin( ${ PI } * ${ getEnvRowEdgeFn }( map, k ) / f32( size.y ) );

	}
`;

// the weights at the four corners of a patch, ordered ( x0 y0, x1 y0, x0 y1, x1 y1 )
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
