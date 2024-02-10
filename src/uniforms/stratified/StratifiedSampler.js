/*
Stratified Sampling
http://www.pbr-book.org/3ed-2018/Sampling_and_Reconstruction/Stratified_Sampling.html

Repeatedly sampling random numbers between [0, 1) has the effect of producing numbers that are coincidentally clustered together,
instead of being evenly spaced across the domain.
This produces low quality results for the path tracer since clustered samples send too many rays in similar directions.

We can reduce the amount of clustering of random numbers by using stratified sampling.
Stratification divides the [0, 1) range into partitions, or stratum, of equal size.
Each invocation of the stratified sampler draws one uniform random number from one stratum from a shuffled sequence of stratums.
When every stratum has been sampled once, this sequence is shuffled again and the process repeats.

The returned sample ranges between [0, numberOfStratum).
The integer part ideintifies the stratum (the first stratum being 0).
The fractional part is the random number.

To obtain the stratified sample between [0, 1), divide the returned sample by the stratum count.
*/

export function shuffle( arr ) {

	for ( let i = arr.length - 1; i > 0; i -- ) {

	  const j = Math.floor( Math.random() * ( i + 1 ) );
	  const x = arr[ i ];
	  arr[ i ] = arr[ j ];
	  arr[ j ] = x;

	}

	return arr;

}

// strataCount : The number of bins per dimension
// dimensions  : The number of dimensions to generate stratified values for
export class StratifiedSampler {

	constructor( strataCount, dimensions ) {

		const l = strataCount ** dimensions;
		const samples = new Float32Array( dimensions );
		const strata = new Uint16Array( l );
		let index = l;

		for ( let i = 0; i < l; i ++ ) {

			strata[ i ] = i;

		}

		this.samples = samples;

		this.strataCount = strataCount;

		this.restart = function () {

			index = 0;

		};

		this.next = function () {

			if ( index >= strata.length ) {

				shuffle( strata );
				this.restart();

			}

			let stratum = strata[ index ++ ];

			for ( let i = 0; i < dimensions; i ++ ) {

				samples[ i ] = ( stratum % strataCount + Math.random() ) / strataCount;
				stratum = Math.floor( stratum / strataCount );

			}

			return samples;

		};

	}

}
