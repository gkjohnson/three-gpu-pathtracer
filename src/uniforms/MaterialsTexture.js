import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, FrontSide, BackSide, DoubleSide } from 'three';

const MATERIAL_PIXELS = 44;
const MATERIAL_STRIDE = MATERIAL_PIXELS * 4;

const SIDE_OFFSET = 12 * 4 + 3; // s12.a
const MATTE_OFFSET = 13 * 4 + 0; // s13.r
const SHADOW_OFFSET = 13 * 4 + 1; // s13.g

export class MaterialsTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 4 ), 1, 1 );

		this.format = RGBAFormat;
		this.type = FloatType;
		this.wrapS = ClampToEdgeWrapping;
		this.wrapT = ClampToEdgeWrapping;
		this.generateMipmaps = false;
		this.threeCompatibilityTransforms = false;

	}

	setCastShadow( materialIndex, cast ) {

		// invert the shadow value so we default to "true" when initializing a material
		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + SHADOW_OFFSET;
		array[ index ] = ! cast ? 1 : 0;

	}

	getCastShadow( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + SHADOW_OFFSET;
		return ! Boolean( array[ index ] );

	}

	setSide( materialIndex, side ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + SIDE_OFFSET;
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
		const index = materialIndex * MATERIAL_STRIDE + SIDE_OFFSET;
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
		const index = materialIndex * MATERIAL_STRIDE + MATTE_OFFSET;
		array[ index ] = matte ? 1 : 0;

	}

	getMatte( materialIndex ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + MATTE_OFFSET;
		return Boolean( array[ index ] );

	}

	updateFrom( materials, textures ) {

		function getTexture( material, key, def = - 1 ) {

			return key in material ? textures.indexOf( material[ key ] ) : def;

		}

		function getField( material, key, def ) {

			return key in material ? material[ key ] : def;

		}

		function getUVTransformTexture( material ) {

			// https://github.com/mrdoob/three.js/blob/f3a832e637c98a404c64dae8174625958455e038/src/renderers/webgl/WebGLMaterials.js#L204-L306
			// https://threejs.org/docs/#api/en/textures/Texture.offset
			// fallback order of textures to use as a common uv transform
			return material.map ||
				material.specularMap ||
				material.displacementMap ||
				material.normalMap ||
				material.bumpMap ||
				material.roughnessMap ||
				material.metalnessMap ||
				material.alphaMap ||
				material.emissiveMap ||
				material.clearcoatMap ||
				material.clearcoatNormalMap ||
				material.clearcoatRoughnessMap ||
				material.iridescenceMap ||
				material.iridescenceThicknessMap ||
				material.specularIntensityMap ||
				material.specularColorMap ||
				material.transmissionMap ||
				material.thicknessMap ||
				material.sheenColorMap ||
				material.sheenRoughnessMap ||
				null;

		}

		function writeTextureMatrixToArray( material, textureKey, array, offset ) {

			let texture;
			if ( threeCompatibilityTransforms ) {

				texture = getUVTransformTexture( material );

			} else {

				texture = material[ textureKey ] && material[ textureKey ].isTexture ? material[ textureKey ] : null;

			}

			// check if texture exists
			if ( texture ) {

				const elements = texture.matrix.elements;

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
		const { threeCompatibilityTransforms, image } = this;

		if ( image.width !== dimension ) {

			this.dispose();

			image.data = new Float32Array( dimension * dimension * 4 );
			image.width = dimension;
			image.height = dimension;

		}

		const floatArray = image.data;

		// on some devices (Google Pixel 6) the "floatBitsToInt" function does not work correctly so we
		// can't encode texture ids that way.
		// const intArray = new Int32Array( floatArray.buffer );

		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];

			// sample 0
			// color
			floatArray[ index ++ ] = m.color.r;
			floatArray[ index ++ ] = m.color.g;
			floatArray[ index ++ ] = m.color.b;
			floatArray[ index ++ ] = getTexture( m, 'map' );

			// sample 1
			// metalness & roughness
			floatArray[ index ++ ] = getField( m, 'metalness', 0.0 );
			floatArray[ index ++ ] = textures.indexOf( m.metalnessMap );
			floatArray[ index ++ ] = getField( m, 'roughness', 0.0 );
			floatArray[ index ++ ] = textures.indexOf( m.roughnessMap );

			// sample 2
			// transmission & emissiveIntensity
			floatArray[ index ++ ] = getField( m, 'ior', 1.0 );
			floatArray[ index ++ ] = getField( m, 'transmission', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'transmissionMap' );
			floatArray[ index ++ ] = getField( m, 'emissiveIntensity', 0.0 );

			// sample 3
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

			// sample 4
			// normals
			floatArray[ index ++ ] = getTexture( m, 'normalMap' );
			if ( 'normalScale' in m ) {

				floatArray[ index ++ ] = m.normalScale.x;
				floatArray[ index ++ ] = m.normalScale.y;

 			} else {

 				floatArray[ index ++ ] = 1;
 				floatArray[ index ++ ] = 1;

 			}

			// clearcoat
			floatArray[ index ++ ] = getField( m, 'clearcoat', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'clearcoatMap' ); // sample 5

			floatArray[ index ++ ] = getField( m, 'clearcoatRoughness', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'clearcoatRoughnessMap' );

			floatArray[ index ++ ] = getTexture( m, 'clearcoatNormalMap' );

			// sample 6
			if ( 'clearcoatNormalScale' in m ) {

				floatArray[ index ++ ] = m.clearcoatNormalScale.x;
				floatArray[ index ++ ] = m.clearcoatNormalScale.y;

			} else {

				floatArray[ index ++ ] = 1;
				floatArray[ index ++ ] = 1;

			}

			index ++;
			index ++;

			// sample 7
			// sheen
			if ( 'sheenColor' in m ) {

				floatArray[ index ++ ] = m.sheenColor.r;
				floatArray[ index ++ ] = m.sheenColor.g;
				floatArray[ index ++ ] = m.sheenColor.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'sheenColorMap' );

			// sample 8
			floatArray[ index ++ ] = getField( m, 'sheenRoughness', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'sheenRoughnessMap' );

			// iridescence
			floatArray[ index ++ ] = getTexture( m, 'iridescenceMap' );
			floatArray[ index ++ ] = getTexture( m, 'iridescenceThicknessMap' );

			floatArray[ index ++ ] = getField( m, 'iridescence', 0.0 ); // sample 9
			floatArray[ index ++ ] = getField( m, 'iridescenceIOR', 1.3 );

			const iridescenceThicknessRange = getField( m, 'iridescenceThicknessRange', [ 100, 400 ] );
			floatArray[ index ++ ] = iridescenceThicknessRange[ 0 ];
			floatArray[ index ++ ] = iridescenceThicknessRange[ 1 ];

			// sample 10
			// specular color
			if ( 'specularColor' in m ) {

				floatArray[ index ++ ] = m.specularColor.r;
				floatArray[ index ++ ] = m.specularColor.g;
				floatArray[ index ++ ] = m.specularColor.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'specularColorMap' );

			// sample 11
			// specular intensity
			floatArray[ index ++ ] = getField( m, 'specularIntensity', 1.0 );
			floatArray[ index ++ ] = getTexture( m, 'specularIntensityMap' );
			index ++;
			index ++;

			// sample 12
			// alphaMap
			floatArray[ index ++ ] = getTexture( m, 'alphaMap' );

			// side & matte
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;
			index ++; // side

			// sample 13
			index ++; // matte
			index ++; // shadow
			index ++;
			index ++;

			// map transform 14
			index += writeTextureMatrixToArray( m, 'map', floatArray, index );

			// metalnessMap transform 16
			index += writeTextureMatrixToArray( m, 'metalnessMap', floatArray, index );

			// roughnessMap transform 18
			index += writeTextureMatrixToArray( m, 'roughnessMap', floatArray, index );

			// transmissionMap transform 20
			index += writeTextureMatrixToArray( m, 'transmissionMap', floatArray, index );

			// emissiveMap transform 22
			index += writeTextureMatrixToArray( m, 'emissiveMap', floatArray, index );

			// normalMap transform 24
			index += writeTextureMatrixToArray( m, 'normalMap', floatArray, index );

			// clearcoatMap transform 26
			index += writeTextureMatrixToArray( m, 'clearcoatMap', floatArray, index );

			// clearcoatNormalMap transform 28
			index += writeTextureMatrixToArray( m, 'clearcoatNormalMap', floatArray, index );

			// clearcoatRoughnessMap transform 30
			index += writeTextureMatrixToArray( m, 'clearcoatRoughnessMap', floatArray, index );

			// sheenColorMap transform 32
			index += writeTextureMatrixToArray( m, 'sheenColorMap', floatArray, index );

			// sheenRoughnessMap transform 34
			index += writeTextureMatrixToArray( m, 'sheenRoughnessMap', floatArray, index );

			// iridescenceMap transform 36
			index += writeTextureMatrixToArray( m, 'iridescenceMap', floatArray, index );

			// iridescenceThicknessMap transform 38
			index += writeTextureMatrixToArray( m, 'iridescenceThicknessMap', floatArray, index );

			// specularColorMap transform 40
			index += writeTextureMatrixToArray( m, 'specularColorMap', floatArray, index );

			// specularIntensityMap transform 42
			index += writeTextureMatrixToArray( m, 'specularIntensityMap', floatArray, index );

		}

		this.needsUpdate = true;

	}

}
