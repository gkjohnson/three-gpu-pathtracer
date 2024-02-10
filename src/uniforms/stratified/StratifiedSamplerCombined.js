/*
Stratified Sampling
http://www.pbr-book.org/3ed-2018/Sampling_and_Reconstruction/Stratified_Sampling.html

It is computationally unfeasible to compute stratified sampling for large dimensions (>2)
Instead, we can compute stratified sampling for lower dimensional patterns that sum to the high dimension
e.g. instead of sampling a 6D domain, we sample a 2D + 2D + 2D domain.
This reaps many benefits of stratification while still allowing for small strata sizes.
*/

import { StratifiedSampler } from './StratifiedSampler.js';

export class StratifiedSamplerCombined {

	constructor( strataCount, listOfDimensions ) {

		let total = 0;
		const strataObjs = [];
		for ( const dim of listOfDimensions ) {

			total += dim;
			strataObjs.push( new StratifiedSampler( strataCount, dim ) );

		}

		const combined = new Float32Array( total );

		this.strataCount = strataCount;

		this.next = function () {

			let i = 0;

			for ( const strata of strataObjs ) {

				const nums = strata.next();

				for ( const num of nums ) {

					combined[ i ++ ] = num;

				}

			}

			return combined;

		};

		this.restart = function () {

			for ( const strata of strataObjs ) {

				strata.restart();

			}

		};

	}

}
