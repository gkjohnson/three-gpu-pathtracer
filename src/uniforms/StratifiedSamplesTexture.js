import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { makeStratifiedSamplerCombined } from './stratified/StratifiedSamplerCombined.js';

export class StratifiedSamplesTexture extends DataTexture {

	constructor( count = 1, depth = 1, strata = 1 ) {

		super( new Float32Array( 1 ), 1, 1, RGBAFormat, FloatType );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;

		this.strata = - 1;
		this.sampler = null;

		this.init( count, depth, strata );

	}

	init( count, depth, strata ) {

		const { image } = this;
		image.width = depth;
		image.height = count;
		image.data = new Float32Array( depth * count * 4 );

		const dimensions = new Array( count * depth ).fill( 4 );
		this.sampler = makeStratifiedSamplerCombined( strata, dimensions );
		this.next();

	}

	next() {

		const data = this.image.data;
		const samples = this.sampler.next();
		const strata = this.sampler.strataCount;
		for ( let i = 0; i < samples.length; i ++ ) {

			data[ i ] = samples[ i ] / strata;

		}

		this.needsUpdate = true;

	}

}
