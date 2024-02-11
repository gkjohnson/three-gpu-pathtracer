import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { StratifiedSamplerCombined } from './stratified/StratifiedSamplerCombined.js';

export class StratifiedSamplesTexture extends DataTexture {

	constructor( count = 1, depth = 1, strata = 8 ) {

		super( new Float32Array( 1 ), 1, 1, RGBAFormat, FloatType );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;

		this.strata = strata;
		this.sampler = null;

		this.init( count, depth, strata );

	}

	init( count, depth, strata = this.strata ) {

		const { image } = this;
		if ( image.width === depth && image.height === count ) {

			return;

		}

		const dimensions = new Array( count * depth ).fill( 4 );
		const sampler = new StratifiedSamplerCombined( strata, dimensions );

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

}
