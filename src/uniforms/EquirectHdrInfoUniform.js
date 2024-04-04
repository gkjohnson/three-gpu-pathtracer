import { DataTexture, RedFormat, LinearFilter, DataUtils, HalfFloatType, Source, RepeatWrapping, RGBAFormat, FloatType, ClampToEdgeWrapping } from 'three';
import { toHalfFloatArray } from '../utils/TextureUtils.js';

function binarySearchFindClosestIndexOf( array, targetValue, offset = 0, count = array.length ) {

	let lower = offset;
	let upper = offset + count - 1;

	while ( lower < upper ) {

		// calculate the midpoint for this iteration using a bitwise shift right operator to save 1 floating point multiplication
		// and 1 truncation from the double tilde operator to improve performance
		// this results in much better performance over using standard "~ ~ ( (lower + upper) ) / 2" to calculate the midpoint
		const mid = ( lower + upper ) >> 1;

		// check if the middle array value is above or below the target and shift
		// which half of the array we're looking at
		if ( array[ mid ] < targetValue ) {

			lower = mid + 1;

		} else {

			upper = mid;

		}

	}

	return lower - offset;

}

function colorToLuminance( r, g, b ) {

	// https://en.wikipedia.org/wiki/Relative_luminance
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;

}

// ensures the data is all floating point values and flipY is false
function preprocessEnvMap( envMap, targetType = HalfFloatType ) {

	const map = envMap.clone();
	map.source = new Source( { ...map.image } );
	const { width, height, data } = map.image;

	// TODO: is there a simple way to avoid cloning and adjusting the env map data here?
	// convert the data from half float uint 16 arrays to float arrays for cdf computation
	let newData = data;
	if ( map.type !== targetType ) {

		if ( targetType === HalfFloatType ) {

			newData = new Uint16Array( data.length );

		} else {

			newData = new Float32Array( data.length );

		}

		let maxIntValue;
		if ( data instanceof Int8Array || data instanceof Int16Array || data instanceof Int32Array ) {

			maxIntValue = 2 ** ( 8 * data.BYTES_PER_ELEMENT - 1 ) - 1;

		} else {

			maxIntValue = 2 ** ( 8 * data.BYTES_PER_ELEMENT ) - 1;

		}

		for ( let i = 0, l = data.length; i < l; i ++ ) {

			let v = data[ i ];
			if ( map.type === HalfFloatType ) {

				v = DataUtils.fromHalfFloat( data[ i ] );

			}

			if ( map.type !== FloatType && map.type !== HalfFloatType ) {

				v /= maxIntValue;

			}

			if ( targetType === HalfFloatType ) {

				newData[ i ] = DataUtils.toHalfFloat( v );

			}

		}

		map.image.data = newData;
		map.type = targetType;

	}

	// remove any y flipping for cdf computation
	if ( map.flipY ) {

		const ogData = newData;
		newData = newData.slice();
		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const newY = height - y - 1;
				const ogIndex = 4 * ( y * width + x );
				const newIndex = 4 * ( newY * width + x );

				newData[ newIndex + 0 ] = ogData[ ogIndex + 0 ];
				newData[ newIndex + 1 ] = ogData[ ogIndex + 1 ];
				newData[ newIndex + 2 ] = ogData[ ogIndex + 2 ];
				newData[ newIndex + 3 ] = ogData[ ogIndex + 3 ];

			}

		}

		map.flipY = false;
		map.image.data = newData;

	}

	return map;

}

export class EquirectHdrInfoUniform {

	constructor() {

		// Default to a white texture and associated weights so we don't
		// just render black initially.
		const blackTex = new DataTexture( toHalfFloatArray( new Float32Array( [ 0, 0, 0, 0 ] ) ), 1, 1 );
		blackTex.type = HalfFloatType;
		blackTex.format = RGBAFormat;
		blackTex.minFilter = LinearFilter;
		blackTex.magFilter = LinearFilter;
		blackTex.wrapS = RepeatWrapping;
		blackTex.wrapT = RepeatWrapping;
		blackTex.generateMipmaps = false;
		blackTex.needsUpdate = true;

		// Stores a map of [0, 1] value -> cumulative importance row & pdf
		// used to sampling a random value to a relevant row to sample from
		const marginalWeights = new DataTexture( toHalfFloatArray( new Float32Array( [ 0, 1 ] ) ), 1, 2 );
		marginalWeights.type = HalfFloatType;
		marginalWeights.format = RedFormat;
		marginalWeights.minFilter = LinearFilter;
		marginalWeights.magFilter = LinearFilter;
		marginalWeights.generateMipmaps = false;
		marginalWeights.needsUpdate = true;

		// Stores a map of [0, 1] value -> cumulative importance column & pdf
		// used to sampling a random value to a relevant pixel to sample from
		const conditionalWeights = new DataTexture( toHalfFloatArray( new Float32Array( [ 0, 0, 1, 1 ] ) ), 2, 2 );
		conditionalWeights.type = HalfFloatType;
		conditionalWeights.format = RedFormat;
		conditionalWeights.minFilter = LinearFilter;
		conditionalWeights.magFilter = LinearFilter;
		conditionalWeights.generateMipmaps = false;
		conditionalWeights.needsUpdate = true;

		this.map = blackTex;
		this.marginalWeights = marginalWeights;
		this.conditionalWeights = conditionalWeights;
		this.totalSum = 0;

		// TODO: Add support for float or half float types here. We need to pass this into
		// the preprocess function and ensure our CDF and MDF textures are appropriately sized
		// Ideally we wouldn't upscale a bit depth if we didn't need to.
		// this.type = HalfFloatType;

	}

	dispose() {

		this.marginalWeights.dispose();
		this.conditionalWeights.dispose();
		this.map.dispose();

	}

	updateFrom( hdr ) {

		// https://github.com/knightcrawler25/GLSL-PathTracer/blob/3c6fd9b6b3da47cd50c527eeb45845eef06c55c3/src/loaders/hdrloader.cpp
		// https://pbr-book.org/3ed-2018/Light_Transport_I_Surface_Reflection/Sampling_Light_Sources#InfiniteAreaLights
		const map = preprocessEnvMap( hdr );
		map.wrapS = RepeatWrapping;
		map.wrapT = ClampToEdgeWrapping;

		const { width, height, data } = map.image;

		// "conditional" = "pixel relative to row pixels sum"
		// "marginal" = "row relative to row sum"

		// track the importance of any given pixel in the image by tracking its weight relative to other pixels in the image
		const pdfConditional = new Float32Array( width * height );
		const cdfConditional = new Float32Array( width * height );

		const pdfMarginal = new Float32Array( height );
		const cdfMarginal = new Float32Array( height );

		let totalSumValue = 0.0;
		let cumulativeWeightMarginal = 0.0;
		for ( let y = 0; y < height; y ++ ) {

			let cumulativeRowWeight = 0.0;
			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const r = DataUtils.fromHalfFloat( data[ 4 * i + 0 ] );
				const g = DataUtils.fromHalfFloat( data[ 4 * i + 1 ] );
				const b = DataUtils.fromHalfFloat( data[ 4 * i + 2 ] );

				// the probability of the pixel being selected in this row is the
				// scale of the luminance relative to the rest of the pixels.
				// TODO: this should also account for the solid angle of the pixel when sampling
				const weight = colorToLuminance( r, g, b );
				cumulativeRowWeight += weight;
				totalSumValue += weight;

				pdfConditional[ i ] = weight;
				cdfConditional[ i ] = cumulativeRowWeight;

			}

			// can happen if the row is all black
			if ( cumulativeRowWeight !== 0 ) {

				// scale the pdf and cdf to [0.0, 1.0]
				for ( let i = y * width, l = y * width + width; i < l; i ++ ) {

					pdfConditional[ i ] /= cumulativeRowWeight;
					cdfConditional[ i ] /= cumulativeRowWeight;

				}

			}

			cumulativeWeightMarginal += cumulativeRowWeight;

			// compute the marginal pdf and cdf along the height of the map.
			pdfMarginal[ y ] = cumulativeRowWeight;
			cdfMarginal[ y ] = cumulativeWeightMarginal;

		}

		// can happen if the texture is all black
		if ( cumulativeWeightMarginal !== 0 ) {

			// scale the marginal pdf and cdf to [0.0, 1.0]
			for ( let i = 0, l = pdfMarginal.length; i < l; i ++ ) {

				pdfMarginal[ i ] /= cumulativeWeightMarginal;
				cdfMarginal[ i ] /= cumulativeWeightMarginal;

			}

		}

		// compute a sorted index of distributions and the probabilities along them for both
		// the marginal and conditional data. These will be used to sample with a random number
		// to retrieve a uv value to sample in the environment map.
		// These values continually increase so it's okay to interpolate between them.
		const marginalDataArray = new Uint16Array( height );
		const conditionalDataArray = new Uint16Array( width * height );

		// we add a half texel offset so we're sampling the center of the pixel
		for ( let i = 0; i < height; i ++ ) {

			const dist = ( i + 1 ) / height;
			const row = binarySearchFindClosestIndexOf( cdfMarginal, dist );

			marginalDataArray[ i ] = DataUtils.toHalfFloat( ( row + 0.5 ) / height );

		}

		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const i = y * width + x;
				const dist = ( x + 1 ) / width;
				const col = binarySearchFindClosestIndexOf( cdfConditional, dist, y * width, width );

				conditionalDataArray[ i ] = DataUtils.toHalfFloat( ( col + 0.5 ) / width );

			}

		}

		this.dispose();

		const { marginalWeights, conditionalWeights } = this;
		marginalWeights.image = { width: height, height: 1, data: marginalDataArray };
		marginalWeights.needsUpdate = true;

		conditionalWeights.image = { width, height, data: conditionalDataArray };
		conditionalWeights.needsUpdate = true;

		this.totalSum = totalSumValue;
		this.map = map;

	}

}
