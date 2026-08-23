import { compress, encode, findTextureMinMax } from '@monogrid/gainmap-js/encode';
import { encodeJPEGMetadata } from '../libs/libultrahdr.js';
import { FloatType, LinearSRGBColorSpace, RGBAFormat } from 'three';

export class HDRImageGenerator {

	constructor( renderer ) {

		this.renderer = renderer;

	}

	async generateBlob( renderTarget ) {

		return new Blob( [ await this.generateArrayBuffer( renderTarget ) ], { type: 'octet/stream' } );

	}

	async generateArrayBuffer( renderTarget ) {

		const renderer = this.renderer;
		const { width, height } = renderTarget;

		// The path tracer output is a StorageTexture, so read it back asynchronously through a render
		// target stub ( WebGPU has no synchronous readback ). The returned rows are padded to a 256
		// byte alignment, so copy out the tightly packed pixels the encoder expects.
		const stub = { textures: [ renderTarget ] };
		const result = await renderer.readRenderTargetPixelsAsync( stub, 0, 0, width, height );
		const padded = result instanceof Float32Array ? result : new Float32Array( result.buffer, result.byteOffset, result.byteLength / 4 );

		// WebGPU strides each source row to a 256 byte alignment ( RGBA float = 16 bytes / texel ),
		// so copy out the tightly packed pixels the encoder expects.
		const BYTES_PER_TEXEL = 16;
		const texelsPerRow = Math.ceil( width * BYTES_PER_TEXEL / 256 ) * 256 / BYTES_PER_TEXEL;
		const buffer = new Float32Array( width * height * 4 );
		for ( let y = 0; y < height; y ++ ) {

			const srcOffset = y * texelsPerRow * 4;
			buffer.set( padded.subarray( srcOffset, srcOffset + width * 4 ), y * width * 4 );

		}

		const imageInformation = {
			header: {},
			width,
			height,
			data: buffer,
			format: RGBAFormat,
			colorSpace: LinearSRGBColorSpace,
			type: FloatType,

		};

		return encodeHDR( imageInformation );

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
		} ),
		compress( {
			source: gainMapImageData,
			mimeType,
			quality,
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
