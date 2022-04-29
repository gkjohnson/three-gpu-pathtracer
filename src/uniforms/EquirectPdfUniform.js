import { Color, DataTexture, FloatType, RGFormat, LinearFilter } from 'three';

function RGBEToLinear( r, g, b, e, target ) {

	const exp = e * 255.0 - 128.0;
	target.set( r, g, b ).multiplyScalar( Math.pow( exp ) );
	return target;

}

function findIndexForValue( array, targetValue, offset = 0, count = array.length ) {

	// TODO: use binary search here?
	for ( let i = 0; i < count; i ++ ) {

		const v = array[ offset + i ];
		if ( targetValue < v ) {

			return i;

		}

	}

	return count - 1;

}

export class EquirectPdfUniform {

	constructor() {

		// Stores a map of [0, 1] value -> cumulative importance row & pdf
		// used to sampling a random value to a relevant row to sample from
		const marginalWeights = new DataTexture();
		marginalWeights.type = FloatType;
		marginalWeights.format = RGFormat;
		marginalWeights.minFilter = LinearFilter;
		marginalWeights.maxFilter = LinearFilter;
		marginalWeights.generateMipmaps = false;

		// Stores a map of [0, 1] value -> cumulative importance column & pdf
		// used to sampling a random value to a relevant pixel to sample from
		const conditionalWeights = new DataTexture();
		conditionalWeights.type = FloatType;
		conditionalWeights.format = RGFormat;
		conditionalWeights.minFilter = LinearFilter;
		conditionalWeights.maxFilter = LinearFilter;
		conditionalWeights.generateMipmaps = false;

		this.marginalWeights = marginalWeights;
		this.conditionalWeights = conditionalWeights;

	}

	updateFrom( hdr ) {

		// TODO: make sure we handle an all black condition
		// TODO: validate the offsets we're providing in the data

		// https://github.com/knightcrawler25/GLSL-PathTracer/blob/3c6fd9b6b3da47cd50c527eeb45845eef06c55c3/src/loaders/hdrloader.cpp
		// https://pbr-book.org/3ed-2018/Light_Transport_I_Surface_Reflection/Sampling_Light_Sources#InfiniteAreaLights
		const { width, height, data } = hdr.image;
		const color = new Color();
		const hsl = {};
		
		// "conditional" = "pixel relative to row pixels sum"
		// "marginal" = "row relative to row sum"

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
		// These values continually increase so it's okay to interpolate between them.
		const marginalDataArray = new Float32Array( height * 2 );
		const conditionalDataArray = new Float32Array( width * height * 2 );

		for ( let i = 0; i < height; i ++ ) {

			const dist = ( i + 1 ) / height;
			let row = findIndexForValue( cdfMarginal, dist );
			
			marginalDataArray[ 2 * i + 0 ] = row / height;
			marginalDataArray[ 2 * i + 1 ] = pdfMarginal[ i ];

		}

		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const dist = ( x + 1 ) / width;
				const col = findIndexForValue( cdfConditional, dist, width * y, width );
				conditionalDataArray[ 2 * i + 0 ] = col / width;
				conditionalDataArray[ 2 * i + 1 ] = pdfConditional[ i ];

			}

		}

		const { marginalWeights, conditionalWeights } = this;
		marginalWeights.dispose();
		marginalWeights.image = { width, height: 1, data: marginalDataArray };
		marginalWeights.needsUpdate = true;

		conditionalWeights.dispose();
		conditionalWeights.image = { width, height, data: conditionalDataArray };
		conditionalWeights.needsUpdate = true;

	}

}
