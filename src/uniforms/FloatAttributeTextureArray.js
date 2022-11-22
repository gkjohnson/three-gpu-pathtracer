import { DataArrayTexture } from 'three';
import { FloatVertexAttributeTexture } from 'three-mesh-bvh';

export class FloatAttributeTextureArray extends DataArrayTexture {

	constructor() {

		super();
		this._textures = [];

	}

	updateTexture( index, attr ) {

		// update all textures
		const tex = this._textures[ index ];
		tex.updateFrom( attr );

		const { width, height, data } = this.image;
		const length = width * height * 4;
		const offset = length * index;
		const floatView = new Float32Array( data.buffer, offset * 4, length );
		floatView.set( tex.image.data );

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
			tex.overrideItemSize = 4;
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
			const floatView = new Float32Array( data.buffer, offset * 4, length );
			floatView.set( tex.image.data );

		}

		// reset the texture
		this.dispose();
		this.needsUpdate = true;

	}


}
