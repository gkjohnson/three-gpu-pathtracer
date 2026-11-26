import { StorageTexture, RedFormat, FloatType, NearestFilter, RepeatWrapping, Vector2 } from 'three/webgpu';
import { texture, storageTexture, globalId, uniform, PI } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from './compute/ComputeKernel.js';

// the texture width WebGPU guarantees, so an 8k environment map's CDFs fit in a few rows
const CDF_TEXTURE_WIDTH = 8192;

// The environment is read with bilinear filtering, which makes its radiance a grid of bilinear patches spanning the
// squares between texel centers, with half patches along the map's borders. Each patch is sampled in proportion to
// its bilinear luminance, as Mitsuba 3's environment emitter does, so the sampling matches the filtered radiance. A
// patch's corners are the filtered luminance at its corners, times the sine of their angle for the solid angle. See
// "Sampling the Bilinear Function" in https://pbr-book.org/4ed/Monte_Carlo_Integration/Transforming_between_Distributions
// and https://github.com/mitsuba-renderer/mitsuba3/blob/master/src/emitters/envmap.cpp
export const getEnvPatchFns = ( mapNode, wrapNode ) => {

	// the texel position of the patch edge "k" along each axis: the map's borders, and the texel centers between them
	const getEdgeFn = wgslTagFn/* wgsl */`
		fn getEnvPatchEdge( k: vec2u ) -> vec2f {

			let size = vec2f( textureDimensions( ${ mapNode } ) );
			return clamp( vec2f( k ) - 0.5, vec2f( 0.0 ), size );

		}
	`;

	// the filtered luminance at a patch corner. Inside the map a corner is a texel center, and on a border that wraps
	// around it's halfway between the texels on either side
	const getCornerLuminanceFn = wgslTagFn/* wgsl */`
		fn getEnvCornerLuminance( k: vec2u ) -> f32 {

			let size = textureDimensions( ${ mapNode } );
			let last = size - 1u;
			let repeat = ${ wrapNode } != vec2f( 0.0 );
			let isLow = k == vec2u( 0u );
			let isHigh = k > size;

			// the texels on either side of the corner along each axis, the same texel inside the map
			let a = select( select( k - 1u, last, isHigh ), select( vec2u( 0u ), last, repeat ), isLow );
			let b = select( select( k - 1u, select( last, vec2u( 0u ), repeat ), isHigh ), vec2u( 0u ), isLow );

			let weights = vec3f( 0.2126, 0.7152, 0.0722 );
			var luminance = dot( textureLoad( ${ mapNode }, a, 0 ).rgb, weights );
			if ( any( a != b ) ) {

				luminance += dot( textureLoad( ${ mapNode }, vec2u( b.x, a.y ), 0 ).rgb, weights );
				luminance += dot( textureLoad( ${ mapNode }, vec2u( a.x, b.y ), 0 ).rgb, weights );
				luminance += dot( textureLoad( ${ mapNode }, b, 0 ).rgb, weights );
				luminance *= 0.25;

			}

			return luminance;

		}
	`;

	// the sampling weight at a patch corner: its luminance times the sine of its angle, the solid angle it covers
	const getCornerWeightFn = wgslTagFn/* wgsl */`
		fn getEnvCornerWeight( k: vec2u ) -> f32 {

			let height = f32( textureDimensions( ${ mapNode } ).y );
			let sinTheta = sin( ${ PI } * ${ getEdgeFn }( k ).y / height );
			return ${ getCornerLuminanceFn }( k ) * sinTheta;

		}
	`;

	// the weights at the four corners of a cell, ordered ( x0 y0, x1 y0, x0 y1, x1 y1 )
	const getCornersFn = wgslTagFn/* wgsl */`
		fn getEnvPatchCorners( cell: vec2u ) -> vec4f {

			return vec4f(
				${ getCornerWeightFn }( cell ),
				${ getCornerWeightFn }( cell + vec2u( 1u, 0u ) ),
				${ getCornerWeightFn }( cell + vec2u( 0u, 1u ) ),
				${ getCornerWeightFn }( cell + vec2u( 1u, 1u ) ),
			);

		}
	`;

	return { getEdgeFn, getCornerWeightFn, getCornersFn };

};

// The importance sampling CDFs of an equirect environment map, built on the GPU. With a "width" x "height" map there
// are "width + 1" x "height + 1" patches. One array laid out in the texture's rows, entry "i" at texel
// ( i % width, i / width ):
// - the marginal CDF over the patch rows, "height + 2" entries led by a zero
// - each patch row's CDF over its patches, "width + 2" entries each, led by a zero
// - the sum of all the patches' weights, in texel units
// A patch's weight is its area in texels times the average of its corner weights, the integral of its bilinear weight
export class EnvironmentCdfTexture extends StorageTexture {

	constructor() {

		// all zeros for a 1x1 map until generated
		super( 10, 1 );
		this.format = RedFormat;
		this.type = FloatType;
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;
		this.generateMipmaps = false;

		// whether the map repeats along x and y, matching its sampler
		this.wrapNode = uniform( new Vector2() );

		this._mapNode = null;
		this._rowKernel = null;
		this._marginalKernel = null;

	}

	// fills the CDFs from the given equirect map's texture
	generate( renderer, envMap ) {

		const { width, height } = envMap.image;
		const count = ( height + 2 ) + ( height + 1 ) * ( width + 2 ) + 1;
		this.setSize( Math.min( count, CDF_TEXTURE_WIDTH ), Math.ceil( count / CDF_TEXTURE_WIDTH ) );

		if ( this._rowKernel === null ) {

			this._initKernels( envMap );

		}

		this._mapNode.value = envMap;
		this.wrapNode.value.set(
			envMap.wrapS === RepeatWrapping ? 1 : 0,
			envMap.wrapT === RepeatWrapping ? 1 : 0,
		);

		const { _rowKernel, _marginalKernel } = this;
		renderer.compute( _rowKernel.kernel, _rowKernel.getDispatchSize( height + 1 ) );
		renderer.compute( _marginalKernel.kernel, [ 1, 1, 1 ] );

	}

	// also called by "setSize" when the size changes, so the kernels are built again for the resized texture
	dispose() {

		super.dispose();
		this._rowKernel?.dispose();
		this._marginalKernel?.dispose();
		this._rowKernel = null;
		this._marginalKernel = null;

	}

	_initKernels( envMap ) {

		const mapNode = texture( envMap );
		const cdfNode = storageTexture( this ).toReadWrite();
		const { getEdgeFn, getCornerWeightFn } = getEnvPatchFns( mapNode, this.wrapNode );

		const readEntryFn = wgslTagFn/* wgsl */`
			fn readCdfEntry( i: u32 ) -> f32 {

				let width = textureDimensions( ${ cdfNode } ).x;
				return textureLoad( ${ cdfNode }, vec2u( i % width, i / width ) ).r;

			}
		`;

		const writeEntryFn = wgslTagFn/* wgsl */`
			fn writeCdfEntry( i: u32, value: f32 ) -> void {

				let width = textureDimensions( ${ cdfNode } ).x;
				textureStore( ${ cdfNode }, vec2u( i % width, i / width ), vec4f( value ) );

			}
		`;

		// the integral of a patch's bilinear weight: its area times the average of its corners. Each column passes its
		// right corners on as the next column's left ones
		const getPatchWeightFn = wgslTagFn/* wgsl */`
			fn getPatchWeight( cell: vec2u, left: ptr<function, vec2f> ) -> f32 {

				let right = vec2f(
					${ getCornerWeightFn }( cell + vec2u( 1u, 0u ) ),
					${ getCornerWeightFn }( cell + vec2u( 1u, 1u ) ),
				);
				let size = ${ getEdgeFn }( cell + vec2u( 1u ) ) - ${ getEdgeFn }( cell );
				let weight = size.x * size.y * 0.25 * ( ( *left ).x + ( *left ).y + right.x + right.y );
				*left = right;
				return weight;

			}
		`;

		// one thread per patch row writes the row's conditional CDF, normalized to end at one, and leaves the row's
		// total in its marginal entry for the next kernel
		const rowFn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				let size = textureDimensions( ${ mapNode } );
				let row = globalId.x;
				if ( row > size.y ) {

					return;

				}

				let firstLeft = vec2f( ${ getCornerWeightFn }( vec2u( 0u, row ) ), ${ getCornerWeightFn }( vec2u( 0u, row + 1u ) ) );
				var left = firstLeft;
				var total = 0.0;
				for ( var x = 0u; x <= size.x; x ++ ) {

					total += ${ getPatchWeightFn }( vec2u( x, row ), &left );

				}

				// an all black row is never picked, so its CDF is left at zero
				let rowStart = size.y + 2u + row * ( size.x + 2u );
				left = firstLeft;
				var sum = 0.0;
				${ writeEntryFn }( rowStart, 0.0 );
				for ( var x = 0u; x <= size.x; x ++ ) {

					sum += ${ getPatchWeightFn }( vec2u( x, row ), &left );
					${ writeEntryFn }( rowStart + x + 1u, select( 0.0, sum / total, total > 0.0 ) );

				}

				${ writeEntryFn }( row + 1u, total );

			}
		`;

		// one thread turns the row totals into the marginal CDF, normalized to end at one, and writes the total last
		const marginalFn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				if ( globalId.x != 0u ) {

					return;

				}

				let size = textureDimensions( ${ mapNode } );
				var total = 0.0;
				for ( var y = 0u; y <= size.y; y ++ ) {

					total += ${ readEntryFn }( y + 1u );

				}

				var sum = 0.0;
				${ writeEntryFn }( 0u, 0.0 );
				for ( var y = 0u; y <= size.y; y ++ ) {

					sum += ${ readEntryFn }( y + 1u );
					${ writeEntryFn }( y + 1u, select( 0.0, sum / total, total > 0.0 ) );

				}

				${ writeEntryFn }( size.y + 2u + ( size.y + 1u ) * ( size.x + 2u ), total );

			}
		`;

		this._mapNode = mapNode;
		this._rowKernel = new ComputeKernel( rowFn( { globalId } ), { workgroupSize: [ 64 ] } );
		this._marginalKernel = new ComputeKernel( marginalFn( { globalId } ), { workgroupSize: [ 1 ] } );

	}

}
