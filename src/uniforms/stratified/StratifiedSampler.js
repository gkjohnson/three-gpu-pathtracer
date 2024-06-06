// Stratified Sampling based on implementation from hoverinc pathtracer
// - https://github.com/hoverinc/ray-tracing-renderer
// - http://www.pbr-book.org/3ed-2018/Sampling_and_Reconstruction/Stratified_Sampling.html

export function shuffle( arr, random = Math.random() ) {

	for ( let i = arr.length - 1; i > 0; i -- ) {

	  const j = Math.floor( random() * ( i + 1 ) );
	  const x = arr[ i ];
	  arr[ i ] = arr[ j ];
	  arr[ j ] = x;

	}

	return arr;

}

// strataCount : The number of bins per dimension
// dimensions  : The number of dimensions to generate stratified values for
export class StratifiedSampler {

	constructor( strataCount, dimensions, random = Math.random ) {

		const l = strataCount ** dimensions;
		const strata = new Uint16Array( l );
		let index = l;

		// each integer represents a statum bin
		for ( let i = 0; i < l; i ++ ) {

			strata[ i ] = i;

		}

		this.samples = new Float32Array( dimensions );

		this.strataCount = strataCount;

		this.reset = function () {

			for ( let i = 0; i < l; i ++ ) {

				strata[ i ] = i;

			}

			index = 0;

		};

		this.reshuffle = function () {

			index = 0;

		};

		this.next = function () {

			const { samples } = this;

			if ( index >= strata.length ) {

				shuffle( strata, random );
				this.reshuffle();

			}

			let stratum = strata[ index ++ ];

			for ( let i = 0; i < dimensions; i ++ ) {

				samples[ i ] = ( stratum % strataCount + random() ) / strataCount;
				stratum = Math.floor( stratum / strataCount );

			}

			return samples;

		};

	}

}
