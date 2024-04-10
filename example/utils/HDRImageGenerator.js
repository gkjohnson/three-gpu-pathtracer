import { compress, encode, findTextureMinMax } from '@monogrid/gainmap-js/dist/encode.js';
import { encodeJPEGMetadata } from '../libs/libultrahdr.js';
import { FloatType, LinearSRGBColorSpace, RGBAFormat } from 'three';

export class HDRImageGenerator {

	get completeImage() {

		return this._lastUrl !== null;

	}

	constructor( renderer, imageElement = new Image() ) {

		this.renderer = renderer;
		this.image = imageElement;
		this.encoding = false;
		this._lastUrl = null;
		this._encodingId = - 1;

	}

	async updateFrom( renderTarget ) {

		if ( this.encoding ) {

			throw new Error( 'HDRImageGenerator: HDR image already being encoded.' );

		}

		const renderer = this.renderer;
		const buffer = new Float32Array( renderTarget.width * renderTarget.height * 4 );
		renderer.readRenderTargetPixels( renderTarget, 0, 0, renderTarget.width, renderTarget.height, buffer );

		const imageInformation = {
			header: {},
			width: renderTarget.width,
			height: renderTarget.height,
			data: buffer,
			format: RGBAFormat,
			colorSpace: LinearSRGBColorSpace,
			type: FloatType,

		};


		this._encodingId ++;
		this.encoding = true;

		const currentId = this._encodingId;
		const jpegData = await encodeHDR( imageInformation );

		if ( this._encodingId === currentId ) {

			if ( this._lastUrl ) {

				URL.revokeObjectURL( this._lastUrl );

			}

			const blob = new Blob( [ jpegData ], { type: 'octet/stream' } );
			this._lastUrl = URL.createObjectURL( blob );
			this.image.src = this._lastUrl;
			this.encoding = false;

		}

	}

	reset() {

		if ( this.encoding ) {

			this.encoding = false;
			this._encodingId ++;

		}

		if ( this._lastUrl ) {

			URL.revokeObjectURL( this._lastUrl );
			this.image.src = '';
			this._lastUrl = null;

		}

	}

}



async function encodeHDR( image ) {

	// find RAW RGB Max value of a texture
	const textureMax = await findTextureMinMax( image );

	// Encode the gainmap
	const encodingResult = encode( {
		image,
		// this will encode the full HDR range
		maxContentBoost: Math.max.apply( this, textureMax ) || 1
	} );

	// obtain the RAW RGBA SDR buffer and create an ImageData
	const sdrImageData = new ImageData(
		encodingResult.sdr.toArray(),
		encodingResult.sdr.width,
		encodingResult.sdr.height
	);
	// obtain the RAW RGBA Gain map buffer and create an ImageData
	const gainMapImageData = new ImageData(
		encodingResult.gainMap.toArray(),
		encodingResult.gainMap.width,
		encodingResult.gainMap.height
	);

	// parallel compress the RAW buffers into the specified mimeType
	const mimeType = 'image/jpeg';
	const quality = 0.9;

	const [ sdr, gainMap ] = await Promise.all( [
		compress( {
			source: sdrImageData,
			mimeType,
			quality,
			flipY: true // output needs to be flipped
		} ),
		compress( {
			source: gainMapImageData,
			mimeType,
			quality,
			flipY: true // output needs to be flipped
		} )
	] );

	// obtain the metadata which will be embedded into
	// and XMP tag inside the final JPEG file
	const metadata = encodingResult.getMetadata();

	// embed the compressed images + metadata into a single
	// JPEG file
	const jpegBuffer = await encodeJPEGMetadata( {
		...encodingResult,
		...metadata,
		sdr,
		gainMap
	} );

	return jpegBuffer;

}
