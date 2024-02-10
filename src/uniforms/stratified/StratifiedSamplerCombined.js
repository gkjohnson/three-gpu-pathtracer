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

		let totalDim = 0;
		for ( const dim of listOfDimensions ) {

			totalDim += dim;

		}

		const combined = new Float32Array( totalDim );
		const strataObjs = [];
		let offset = 0;
		for ( const dim of listOfDimensions ) {

			const sampler = new StratifiedSampler( strataCount, dim );
			sampler.samples = new Float32Array( combined.buffer, offset, sampler.samples.length );
			offset += sampler.samples.length * 4;
			strataObjs.push( sampler );

		}


		this.samples = combined;

		this.strataCount = strataCount;

		this.next = function () {

			for ( const strata of strataObjs ) {

				strata.next();

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
