import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, FrontSide, BackSide, DoubleSide, Matrix3 } from 'three';

const MATERIAL_PIXELS = 13;
const MATERIAL_STRIDE = MATERIAL_PIXELS * 4;

export class MaterialsTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 4 ), 1, 1 );

		this.format = RGBAFormat;
		this.type = FloatType;
		this.wrapS = ClampToEdgeWrapping;
		this.wrapT = ClampToEdgeWrapping;
		this.generateMipmaps = false;

	}

	setCastShadow( materialIndex, cast ) {

		// invert the shadow value so we default to "true" when initializing a material
		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 6 * 4 + 0;
		array[ index ] = ! cast ? 1 : 0;

	}

	getCastShadow( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 6 * 4 + 0;
		return ! Boolean( array[ index ] );

	}

	setSide( materialIndex, side ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 2;
		switch ( side ) {

			case FrontSide:
				array[ index ] = 1;
				break;
			case BackSide:
				array[ index ] = - 1;
				break;
			case DoubleSide:
				array[ index ] = 0;
				break;

		}

	}

	getSide( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 2;
		switch ( array[ index ] ) {

			case 0:
				return DoubleSide;
			case 1:
				return FrontSide;
			case - 1:
				return BackSide;

		}

		return 0;

	}

	setMatte( materialIndex, matte ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 3;
		array[ index ] = matte ? 1 : 0;

	}

	getMatte( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 3;
		return Boolean( array[ index ] );

	}

	updateFrom( materials, textures ) {

		function getTexture( material, key, def = - 1 ) {

			return key in material ? textures.indexOf( material[ key ] ) : def;

		}

		function getField( material, key, def ) {

			return key in material ? material[ key ] : def;

		}

		/**
		 *
		 * @param {Object} material
		 * @param {string} textureKey
		 * @param {Float32Array} array
		 * @param {number} offset
		 * @returns {8} number of floats occupied by texture transform matrix
		 */
		function writeTextureMatrixToArray( material, textureKey, array, offset ) {

			// check if is texture exists
			if ( material[ textureKey ] && material[ textureKey ].isTexture ) {

				const elements = material[ textureKey ].matrix.elements;

				let i = 0;

				// first row
				array[ offset + i ++ ] = elements[ 0 ];
				array[ offset + i ++ ] = elements[ 3 ];
				array[ offset + i ++ ] = elements[ 6 ];
				i ++;

				// second row
				array[ offset + i ++ ] = elements[ 1 ];
				array[ offset + i ++ ] = elements[ 4 ];
				array[ offset + i ++ ] = elements[ 7 ];
				i ++;

			}

			return 8;

		}

		let index = 0;
		const pixelCount = materials.length * MATERIAL_PIXELS;
		const dimension = Math.ceil( Math.sqrt( pixelCount ) );

		if ( this.image.width !== dimension ) {

			this.dispose();

			this.image.data = new Float32Array( dimension * dimension * 4 );
			this.image.width = dimension;
			this.image.height = dimension;

		}

		const floatArray = this.image.data;

		// on some devices (Google Pixel 6) the "floatBitsToInt" function does not work correctly so we
		// can't encode texture ids that way.
		// const intArray = new Int32Array( floatArray.buffer );

		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];

			// color
			floatArray[ index ++ ] = m.color.r;
			floatArray[ index ++ ] = m.color.g;
			floatArray[ index ++ ] = m.color.b;
			floatArray[ index ++ ] = getTexture( m, 'map' );

			// metalness & roughness
			floatArray[ index ++ ] = getField( m, 'metalness', 0.0 );
			floatArray[ index ++ ] = textures.indexOf( m.metalnessMap );
			floatArray[ index ++ ] = getField( m, 'roughness', 0.0 );
			floatArray[ index ++ ] = textures.indexOf( m.roughnessMap );

			// transmission & emissiveIntensity
			floatArray[ index ++ ] = getField( m, 'ior', 1.0 );
			floatArray[ index ++ ] = getField( m, 'transmission', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'transmissionMap' );
			floatArray[ index ++ ] = getField( m, 'emissiveIntensity', 0.0 );

			// emission
			if ( 'emissive' in m ) {

				floatArray[ index ++ ] = m.emissive.r;
				floatArray[ index ++ ] = m.emissive.g;
				floatArray[ index ++ ] = m.emissive.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'emissiveMap' );

			// normals
			floatArray[ index ++ ] = getTexture( m, 'normalMap' );
			if ( 'normalScale' in m ) {

				floatArray[ index ++ ] = m.normalScale.x;
				floatArray[ index ++ ] = m.normalScale.y;

 			} else {

 				floatArray[ index ++ ] = 1;
 				floatArray[ index ++ ] = 1;

 			}

			index ++;

			// side & matte
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;
			index ++; // side
			index ++; // matte

			index ++; // shadow
			index ++;
			index ++;
			index ++;

			// map transform
			index += writeTextureMatrixToArray( m, 'map', floatArray, index );

			// metalnessMap transform
			index += writeTextureMatrixToArray( m, 'metalnessMap', floatArray, index );

			// roughnessMap transform
			index += writeTextureMatrixToArray( m, 'roughnessMap', floatArray, index );

		}

		this.needsUpdate = true;

	}

}
