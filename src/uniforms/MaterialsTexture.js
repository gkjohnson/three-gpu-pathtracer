import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, FrontSide, BackSide, DoubleSide } from 'three';

const MATERIAL_PIXELS = 6;
const MATERIAL_STRIDE = 6 * 4;

export class MaterialsTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 4 ), 1, 1 );

		this.format = RGBAFormat;
		this.type = FloatType;
		this.wrapS = ClampToEdgeWrapping;
		this.wrapT = ClampToEdgeWrapping;
		this.generateMipmaps = false;

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
		const intArray = new Int32Array( floatArray.buffer );

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

		}

		this.needsUpdate = true;

	}

}
