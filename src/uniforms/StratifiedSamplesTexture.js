import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { StratifiedSamplerCombined } from './stratified/StratifiedSamplerCombined.js';

export class StratifiedSamplesTexture extends DataTexture {

	constructor( count = 1, depth = 1, strata = 8 ) {

		super( new Float32Array( 1 ), 1, 1, RGBAFormat, FloatType );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;

		this.strata = 8;
		this.sampler = null;

		this.init( count, depth, strata );

	}

	init( count, depth, strata = this.strata ) {

		const { image } = this;
		if ( image.width === depth && image.height === count ) {

			return;

		}

		image.width = depth;
		image.height = count;
		image.data = new Float32Array( depth * count * 4 );

		const dimensions = new Array( count * depth ).fill( 4 );
		this.sampler = new StratifiedSamplerCombined( strata, dimensions );

		this.dispose();
		this.next();

	}

	next() {

		const data = this.image.data;
		const samples = this.sampler.next();
		for ( let i = 0; i < samples.length; i ++ ) {

			data[ i ] = samples[ i ];

		}

		this.needsUpdate = true;

	}

}
