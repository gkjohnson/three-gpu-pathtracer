import { DataTexture, NearestFilter } from 'three/webgpu';

// the width of the rows, the texture width WebGPU guarantees, so an 8k environment map's CDF fits
const LINEAR_TEXTURE_WIDTH = 8192;

// A data texture holding a 1D array of "itemSize" component items in rows, since a texture's width is limited.
// Item "i" is at texel ( i % width, i / width ). Read with "textureLoad", it needs no sampler
export class LinearDataTexture extends DataTexture {

	constructor( array, itemSize, format, type ) {

		const count = array.length / itemSize;
		const width = Math.min( Math.max( count, 1 ), LINEAR_TEXTURE_WIDTH );
		const height = Math.max( Math.ceil( count / width ), 1 );
		const data = new array.constructor( width * height * itemSize );
		data.set( array );

		super( data, width, height, format, type );
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;
		this.generateMipmaps = false;
		this.needsUpdate = true;

	}

}
