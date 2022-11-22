import { DataArrayTexture, FloatType, RGBAFormat } from 'three';
import { FloatVertexAttributeTexture } from 'three-mesh-bvh';

function copyArrayToArray( fromArray, fromStride, toArray, offset ) {

	const count = fromArray.length / fromStride;
	for ( let i = 0; i < count; i ++ ) {

		const i4 = 4 * i;
		const is = fromStride * i;
		toArray[ offset + i4 + 0 ] = fromArray[ is + 0 ];
		toArray[ offset + i4 + 1 ] = fromStride >= 2 ? fromArray[ is + 1 ] : 0;
		toArray[ offset + i4 + 2 ] = fromStride >= 3 ? fromArray[ is + 2 ] : 0;
		toArray[ offset + i4 + 3 ] = fromStride >= 4 ? fromArray[ is + 3 ] : 0;

	}

}

export class FloatAttributeTextureArray extends DataArrayTexture {

	constructor() {

		super();
		this._textures = [];
		this.type = FloatType;
		this.format = RGBAFormat;
		this.internalFormat = 'RGBA32F';

	}

	updateTexture( index, attr ) {

		// update all textures
		const tex = this._textures[ index ];
		tex.updateFrom( attr );

		const { width, height, data } = this.image;
		const length = width * height * 4;
		const offset = length * index;
		let itemSize = attr.itemSize;
		if ( itemSize === 3 ) {

			itemSize = 4;

		}

		copyArrayToArray( tex.image.data, itemSize, data, offset );

		this.dispose();
		this.needsUpdate = true;

	}

	setAttributes( attrs ) {

		// ensure the attribute count
		const itemCount = attrs[ 0 ].count;
		const attrsLength = attrs.length;
		for ( let i = 0, l = attrsLength; i < l; i ++ ) {

			if ( attrs[ i ].count !== itemCount ) {

				throw new Error( 'FloatAttributeTextureArray: All attributes must have the same item count.' );

			}

		}

		// initialize all textures
		const textures = this._textures;
		while ( textures.length < attrsLength ) {

			const tex = new FloatVertexAttributeTexture();
			textures.push( tex );

		}

		while ( textures.length > attrsLength ) {

			textures.pop();

		}

		// update all textures
		for ( let i = 0, l = attrsLength; i < l; i ++ ) {

			textures[ i ].updateFrom( attrs[ i ] );

		}

		// determine if we need to create a new array
		const rootTexture = textures[ 0 ];
		let { data, width, depth, height } = this.image;
		if ( rootTexture.image.width !== width || rootTexture.image.height !== height || depth !== attrsLength ) {

			width = rootTexture.image.width;
			height = rootTexture.image.height;
			depth = attrsLength;
			data = new Float32Array( width * height * depth * 4 );

			this.image.width = width;
			this.image.height = height;
			this.image.depth = depth;
			this.image.data = data;

		}

		// copy the other texture data into the data array texture
		for ( let i = 0, l = attrsLength; i < l; i ++ ) {

			const tex = textures[ i ];
			const length = width * height * 4;
			const offset = length * i;

			let itemSize = attrs[ i ].itemSize;
			if ( itemSize === 3 ) {

				itemSize = 4;

			}

			copyArrayToArray( tex.image.data, itemSize, data, offset );

		}

		// reset the texture
		this.dispose();
		this.needsUpdate = true;

	}


}
