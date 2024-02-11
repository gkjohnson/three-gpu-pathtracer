import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { BlueNoiseGenerator } from './blueNoise/BlueNoiseGenerator.js';

export class BlueNoiseTexture extends DataTexture {

	constructor( size = 64, channels = 1 ) {

		super( new Float32Array( 4 ), 1, 1, RGBAFormat, FloatType );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;

		this.size = size;
		this.channels = channels;
		this.update();

	}

	update() {


		const channels = this.channels;
		const size = this.size;
		const generator = new BlueNoiseGenerator();
		generator.channels = channels;
		generator.size = size;

		if ( this.image.width !== size ) {

			this.image.width = size;
			this.image.height = size;
			this.image.data = new Float32Array( ( size ** 2 ) * 4 );
			this.dispose();

		}

		const data = this.image.data;
		for ( let i = 0, l = channels; i < l; i ++ ) {

			const result = generator.generate();
			const bin = result.data;
			const maxValue = result.maxValue;

			if ( channels === 1 ) {

				for ( let j = 0, l2 = bin.length; j < l2; j ++ ) {

					const value = bin[ j ] / maxValue;
					for ( let c = i; c < 4; c ++ ) {

						data[ j * 4 + c ] = value;

					}

				}

			} else {

				for ( let j = 0, l2 = bin.length; j < l2; j ++ ) {

					const value = bin[ j ] / maxValue;
					data[ j * 4 + i ] = value;

				}

			}

		}

		this.needsUpdate = true;

	}

}
