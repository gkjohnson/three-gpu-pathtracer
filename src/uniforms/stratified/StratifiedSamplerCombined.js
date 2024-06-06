// Stratified Sampling based on implementation from hoverinc pathtracer
// - https://github.com/hoverinc/ray-tracing-renderer
// - http://www.pbr-book.org/3ed-2018/Sampling_and_Reconstruction/Stratified_Sampling.html

import { StratifiedSampler } from './StratifiedSampler.js';

// Stratified set of data with each tuple stratified separately and combined
export class StratifiedSamplerCombined {

	constructor( strataCount, listOfDimensions, random = Math.random ) {

		let totalDim = 0;
		for ( const dim of listOfDimensions ) {

			totalDim += dim;

		}

		const combined = new Float32Array( totalDim );
		const strataObjs = [];
		let offset = 0;
		for ( const dim of listOfDimensions ) {

			const sampler = new StratifiedSampler( strataCount, dim, random );
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

		this.reshuffle = function () {

			for ( const strata of strataObjs ) {

				strata.reshuffle();

			}

		};

		this.reset = function () {

			for ( const strata of strataObjs ) {

				strata.reset();

			}

		};

	}

}
