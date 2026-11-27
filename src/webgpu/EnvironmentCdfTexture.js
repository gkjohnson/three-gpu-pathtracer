import { StorageTexture, RedFormat, FloatType, NearestFilter } from 'three/webgpu';
import { texture, storageTexture, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from './compute/ComputeKernel.js';
import { getEnvPatchRowStartFn, getEnvPatchCornersFn } from './nodes/cdf.wgsl.js';

// the texture width WebGPU guarantees, so an 8k environment map's CDFs fit in a few rows
const CDF_TEXTURE_WIDTH = 8192;

// The importance sampling CDFs of an equirect environment map, built on the GPU. With a "width" x "height" map there
// are "width" x "height + 1" patches. One array laid out in the texture's rows, entry "i" at texel
// ( i % width, i / width ):
// - the marginal CDF over the patch rows, "height + 2" entries led by a zero
// - each patch row's CDF over its patches, "width + 1" entries each, led by a zero
// - the sum of all the patches' weights, in texels
// A patch's weight is its area in texels times the average of its corner weights, the integral of its bilinear weight
export class EnvironmentCdfTexture extends StorageTexture {

	constructor() {

		// all zeros for a 1x1 map until generated
		super( 8, 1 );
		this.format = RedFormat;
		this.type = FloatType;
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;
		this.generateMipmaps = false;

		this._mapNode = null;
		this._rowKernel = null;
		this._marginalKernel = null;

	}

	// fills the CDFs from the given equirect map's texture
	generate( renderer, envMap ) {

		const { width, height } = envMap.image;
		const count = ( height + 2 ) + ( height + 1 ) * ( width + 1 ) + 1;
		this.setSize( Math.min( count, CDF_TEXTURE_WIDTH ), Math.ceil( count / CDF_TEXTURE_WIDTH ) );

		if ( this._rowKernel === null ) {

			this._initKernels( envMap );

		}

		this._mapNode.value = envMap;

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

		// the integral of a patch's bilinear weight: its area times the average of its corners
		const getPatchWeightFn = wgslTagFn/* wgsl */`
			fn getPatchWeight( cell: vec2u ) -> f32 {

				let height = ${ getEnvPatchRowStartFn }( ${ mapNode }, cell.y + 1u ) - ${ getEnvPatchRowStartFn }( ${ mapNode }, cell.y );
				return height * dot( ${ getEnvPatchCornersFn }( ${ mapNode }, cell ), vec4f( 0.25 ) );

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

				var total = 0.0;
				for ( var x = 0u; x < size.x; x ++ ) {

					total += ${ getPatchWeightFn }( vec2u( x, row ) );

				}

				// an all black row is never picked, so its CDF is left at zero
				let rowStart = size.y + 2u + row * ( size.x + 1u );
				var sum = 0.0;
				${ writeEntryFn }( rowStart, 0.0 );
				for ( var x = 0u; x < size.x; x ++ ) {

					sum += ${ getPatchWeightFn }( vec2u( x, row ) );
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

				${ writeEntryFn }( size.y + 2u + ( size.y + 1u ) * ( size.x + 1u ), total );

			}
		`;

		this._mapNode = mapNode;
		this._rowKernel = new ComputeKernel( rowFn( { globalId } ), { workgroupSize: [ 64 ] } );
		this._marginalKernel = new ComputeKernel( marginalFn( { globalId } ), { workgroupSize: [ 1 ] } );

	}

}
