import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, FrontSide, BackSide, DoubleSide } from 'three';

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
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 0;
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

	setMatte( materialIndex, matte ) {

		const array = this.image.data;
		const index = materialIndex * MATERIAL_STRIDE + 5 * 4 + 1;
		array[ index ] = matte ? 1 : 0;

	}

	updateFrom( materials, textures ) {

		let index = 0;
		const count = materials.length * MATERIAL_STRIDE;
		const dimension = Math.ceil( Math.sqrt( count ) );

		if ( this.data.width !== dimension ) {

			this.dispose();
			this.needsUpdate = true;

			this.image.data = new Float32Array( count );
			this.image.width = dimension;
			this.image.height = dimension;

		}

		const floatArray = this.image.data;
		const intArray = new Int32Array( floatArray.buffer );

		for ( let i = 0, l = count; i < l; i ++ ) {

			const m = materials[ i ];

			// color
			floatArray[ index ++ ] = m.color.r;
			floatArray[ index ++ ] = m.color.g;
			floatArray[ index ++ ] = m.color.b;
			intArray[ index ++ ] = textures.indexOf( m.map );

			// metalness & roughness
			floatArray[ index ++ ] = m.metalness;
			intArray[ index ++ ] = textures.indexOf( m.metalnessMap );
			floatArray[ index ++ ] = m.roughess;
			intArray[ index ++ ] = textures.indexOf( m.roughnessMap );

			// transmission & emissiveIntensity
			floatArray[ index ++ ] = m.ior;
			floatArray[ index ++ ] = m.transmission;
			intArray[ index ++ ] = textures.indexOf( m.ior );
			floatArray[ index ++ ] = m.emissiveIntensity;

			// emission
			floatArray[ index ++ ] = m.emissive.r;
			floatArray[ index ++ ] = m.emissive.g;
			floatArray[ index ++ ] = m.emissive.b;
			intArray[ index ++ ] = textures.indexOf( m.emissiveMap );

			// normals
			intArray[ index ++ ] = textures.indexOf( m.normalMap );
			floatArray[ index ++ ] = m.normalScale.x;
			floatArray[ index ++ ] = m.normalScale.y;
			index ++;

			// side & matte
			index ++; // side
			index ++; // matte
			index ++;
			index ++;

		}

	}

}
