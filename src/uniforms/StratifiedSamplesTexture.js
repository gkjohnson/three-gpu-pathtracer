import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { makeStratifiedSamplerCombined } from './stratified/StratifiedSamplerCombined.js';

export class StratifiedSamplesTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 1 ), 1, 1, RGBAFormat, FloatType );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;

		this.sampler = null;

	}

	init( count, strata ) {

		const dimensions = new Array( count ).fill( 4 );
		this.sampler = new makeStratifiedSamplerCombined( strata, dimensions );

	}

	next() {

		const data = this.sampler.next();
		// regenerate the new data, wrap around if needed

		this.needsUpdate = true;

	}

}
