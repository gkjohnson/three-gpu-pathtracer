import { Color, DataTexture, FloatType, RGFormat, LinearFilter } from 'three';

function findIndexForValue( array, targetValue, offset = 0, count = array.length ) {

	// TODO: use binary search here
	// TODO: confirm the result here is right
	for ( let i = 0; i < count; i ++ ) {

		const v = array[ offset + i ];
		if ( targetValue < v ) {

			return i;

		}

	}

	return count;

}

export class EquirectHdrInfoUniform {

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
		this.map = null;
		this.totalSum = 0;

	}

	dispose() {

		this.marginalWeights.dispose();
		this.conditionalWeights.dispose();
		if ( this.map ) this.map.dispose();

	}

	updateFrom( hdr ) {

		// TODO: make sure we handle an all black condition
		// TODO: validate the offsets we're providing in the data

		// https://github.com/knightcrawler25/GLSL-PathTracer/blob/3c6fd9b6b3da47cd50c527eeb45845eef06c55c3/src/loaders/hdrloader.cpp
		// https://pbr-book.org/3ed-2018/Light_Transport_I_Surface_Reflection/Sampling_Light_Sources#InfiniteAreaLights
		const { width, height, data } = hdr.image;

		// "conditional" = "pixel relative to row pixels sum"
		// "marginal" = "row relative to row sum"

		// track the importance of any given pixel in the image by tracking its weight relative to other pixels in the image
		const pdfConditional = new Float32Array( width * height );
		const cdfConditional = new Float32Array( width * height );

		const pdfMarginal = new Float32Array( height );
		const cdfMarginal = new Float32Array( height );

		let totalSum = 0.0;
		let cumulativeWeightMarginal = 0.0;
		for ( let y = 0; y < height; y ++ ) {

			let cumulativeRowWeight = 0.0;
			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const r = data[ 4 * i + 0 ];
				const g = data[ 4 * i + 1 ];
				const b = data[ 4 * i + 2 ];

				// the probability of the pixel being selected in this row is the
				// scale of the luminance relative to the rest of the pixels.
				// TODO: this should also account for the solid angle of the pixel when sampling
				const weight = colorToLuminance( r, g, b );
				cumulativeRowWeight += weight;
				totalSum += weight;

				pdfConditional[ i ] = weight;
				cdfConditional[ i ] = cumulativeRowWeight;

			}

			// scale the pdf and cdf to [0.0, 1.0]
			for ( let i = y * width, l = y * width + width; i < l; i ++ ) {

				pdfConditional[ i ] /= cumulativeRowWeight;
				cdfConditional[ i ] /= cumulativeRowWeight;

			}

			cumulativeWeightMarginal += cumulativeRowWeight;

			// compute the marginal pdf and cdf along the height of the map.
			pdfMarginal[ y ] = cumulativeRowWeight;
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
			const row = findIndexForValue( cdfMarginal, dist );

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

		this.dispose();

		const { marginalWeights, conditionalWeights } = this;
		marginalWeights.image = { width: height, height: 1, data: marginalDataArray };
		marginalWeights.needsUpdate = true;

		conditionalWeights.image = { width, height, data: conditionalDataArray };
		conditionalWeights.needsUpdate = true;

		this.map = hdr.clone();
		this.totalSum = totalSum;

	}

}
