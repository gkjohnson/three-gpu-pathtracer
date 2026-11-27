import { DataTexture, NearestFilter } from 'three/webgpu';

// the largest texture width guaranteed by WebGPU. It's a power of two, and the rows are only narrower when there's one,
// so item "i" is always at texel ( i % LINEAR_TEXTURE_WIDTH, i / LINEAR_TEXTURE_WIDTH )
export const LINEAR_TEXTURE_WIDTH = 8192;

// A data texture storing a 1D array that's wrapped into rows. Read with "linearTextureLoad"
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
