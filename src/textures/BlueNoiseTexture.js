import { DataTexture, FloatType, NearestFilter, RGBAFormat, RGFormat, RedFormat } from 'three';
import { BlueNoiseGenerator } from './blueNoise/BlueNoiseGenerator.js';

function getStride( channels ) {

	if ( channels >= 3 ) {

		return 4;

	} else {

		return channels;

	}

}

function getFormat( channels ) {

	switch ( channels ) {

	case 1:
		return RedFormat;
	case 2:
		return RGFormat;
	default:
		return RGBAFormat;

	}

}

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

		const stride = getStride( channels );
		const format = getFormat( stride );
		if ( this.image.width !== size || format !== this.format ) {

			this.image.width = size;
			this.image.height = size;
			this.image.data = new Float32Array( ( size ** 2 ) * stride );
			this.format = format;
			this.dispose();

		}

		const data = this.image.data;
		for ( let i = 0, l = channels; i < l; i ++ ) {

			const result = generator.generate();
			const bin = result.data;
			const maxValue = result.maxValue;

			for ( let j = 0, l2 = bin.length; j < l2; j ++ ) {

				const value = bin[ j ] / maxValue;
				data[ j * stride + i ] = value;

			}

		}

		this.needsUpdate = true;

	}

}
