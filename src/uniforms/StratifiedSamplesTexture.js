import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { StratifiedSamplerCombined } from './stratified/StratifiedSamplerCombined.js';

// https://stackoverflow.com/questions/424292/seedable-javascript-random-number-generator
class RandomGenerator {

	constructor( seed = 0 ) {

		// LCG using GCC's constants
		this.m = 0x80000000; // 2**31;
		this.a = 1103515245;
		this.c = 12345;

		this.seed = seed;

	}

	nextInt() {

		this.seed = ( this.a * this.seed + this.c ) % this.m;
		return this.seed;

	}

	nextFloat() {

		// returns in range [0,1]
		return this.nextInt() / ( this.m - 1 );

	}

}

export class StratifiedSamplesTexture extends DataTexture {

	constructor( count = 1, depth = 1, strata = 8 ) {

		super( new Float32Array( 1 ), 1, 1, RGBAFormat, FloatType );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;

		this.strata = strata;
		this.sampler = null;
		this.generator = new RandomGenerator();
		this.stableNoise = false;
		this.random = () => {

			if ( this.stableNoise ) {

				return this.generator.nextFloat();

			} else {

				return Math.random();

			}

		};

		this.init( count, depth, strata );

	}

	init( count = this.image.height, depth = this.image.width, strata = this.strata ) {

		const { image } = this;
		if ( image.width === depth && image.height === count && this.sampler !== null ) {

			return;

		}

		const dimensions = new Array( count * depth ).fill( 4 );
		const sampler = new StratifiedSamplerCombined( strata, dimensions, this.random );

		image.width = depth;
		image.height = count;
		image.data = sampler.samples;

		this.sampler = sampler;

		this.dispose();
		this.next();

	}

	next() {

		this.sampler.next();
		this.needsUpdate = true;

	}

	reset() {

		this.sampler.reset();
		this.generator.seed = 0;

	}

}
