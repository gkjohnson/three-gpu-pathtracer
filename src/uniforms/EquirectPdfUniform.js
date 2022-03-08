import { Color, DataTexture, FloatType, RGFormat, LinearFilter } from 'three';

function RGBEToLinear( r, g, b, e, target ) {

	const exp = e * 255.0 - 128.0;
	target.set( r, g, b ).multiplyScalar( Math.pow( exp ) );
	return target;

}

export class EquirectPdfUniform {

	constructor() {

		const marginalData = new DataTexture();
		marginalData.type = FloatType;
		marginalData.format = RGFormat;
		marginalData.minFilter = LinearFilter;
		marginalData.maxFilter = LinearFilter;
		marginalData.generateMipmaps = false;

		const conditionalData = new DataTexture();
		conditionalData.type = FloatType;
		conditionalData.format = RGFormat;
		conditionalData.minFilter = LinearFilter;
		conditionalData.maxFilter = LinearFilter;
		conditionalData.generateMipmaps = false;

		this.marginalData = marginalData;
		this.conditionalData = conditionalData;

	}

	updateFrom( hdr ) {

		// TODO: another reference implementation with a different approach:
		// https://github.com/nvpro-samples/vk_mini_samples/blob/main/hdr_sampling/src/hdr_env.cpp#L243

		// https://github.com/knightcrawler25/GLSL-PathTracer/blob/master/src/loaders/hdrloader.cpp
		const { width, height, data } = hdr.image;
		const color = new Color();
		const hsl = {};

		// track the importance of any given pixel in the image by tracking its weight relative to other pixels in the image
		const pdfConditional = new Float32Array( width * height );
		const cdfConditional = new Float32Array( width * height );

		const pdfMarginal = new Float32Array( height );
		const cdfMarginal = new Float32Array( height );

		let cumulativeWeightMarginal = 0.0;
		for ( let y = 0; y < height; y ++ ) {

			let cumulativeWeight = 0.0;
			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const r = data[ 4 * i + 0 ];
				const g = data[ 4 * i + 1 ];
				const b = data[ 4 * i + 2 ];
				const e = data[ 4 * i + 3 ];

				// the probability of the pixel being selected in this row is the
				// scale of the luminance relative to the rest of the pixels.
				// TODO: this should also account for the solid angle of the pixel when sampling
				const weight = RGBEToLinear( r, g, b, e, color ).getHSL( hsl ).l;
				cumulativeWeight += weight;

				pdfConditional[ i ] = weight;
				cdfConditional[ i ] = cumulativeWeight;

			}

			// scale the pdf and cdf to [0.0, 1.0]
			for ( let i = 0, l = pdfConditional.length; i < l; i ++ ) {

				pdfConditional[ i ] /= cumulativeWeight;
				cdfConditional[ i ] /= cumulativeWeight;

			}

			cumulativeWeightMarginal += cumulativeWeight;

			// compute the marginal pdf and cdf along the height of the map.
			pdfMarginal[ y ] = cumulativeWeight;
			cdfMarginal[ y ] = cumulativeWeightMarginal;

		}

		// scale the marginal pdf and cdf to [0.0, 1.0]
		for ( let i = 0, l = pdfMarginal.length; i < l; i ++ ) {

			pdfMarginal[ i ] /= cumulativeWeightMarginal;
			cdfMarginal[ i ] /= cumulativeWeightMarginal;

		}

		// compute a sorted index of distributions and the probabilities along them for both
		// the marginal and conditional data. These will be used to sample with a random number
		// to retrieve a uv value to sample in the environment map.
		const marginalDataArray = new Float32Array( height * 2 );
		const conditionalDataArray = new Float32Array( width * height * 2 );

		for ( let i = 0; i < height; i ++ ) {

			//const dist = ( i + 1 ) / height;
			const row = 0; // TODO: find the row that lies at the given cumulative distribution value above
			marginalDataArray[ 2 * i + 0 ] = row / height;
			marginalDataArray[ 2 * i + 1 ] = pdfMarginal[ i ];

		}

		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				//const dist = ( x + 1 ) / width;
				const col = 0; // TODO: find the column in the given row that lies at the cumulative dist value above
				conditionalDataArray[ 2 * i + 0 ] = col / width;
				conditionalDataArray[ 2 * i + 1 ] = pdfConditional[ i ];

			}

		}

		this.marginalData.image = { width, height, data: marginalDataArray };
		this.conditionalData.image = { width, height, data: conditionalDataArray };

	}

}
