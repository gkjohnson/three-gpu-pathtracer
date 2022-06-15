import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, Vector3, Quaternion } from 'three';

const LIGHT_PIXELS = 4;

export class LightsTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 4 ), 1, 1 );

		this.format = RGBAFormat;
		this.type = FloatType;
		this.wrapS = ClampToEdgeWrapping;
		this.wrapT = ClampToEdgeWrapping;
		this.generateMipmaps = false;

	}

	updateFrom( lights ) {

		let index = 0;
		const pixelCount = lights.length * LIGHT_PIXELS;
		const dimension = Math.ceil( Math.sqrt( pixelCount ) );

		if ( this.image.width !== dimension ) {

			this.dispose();

			this.image.data = new Float32Array( dimension * dimension * 4 );
			this.image.width = dimension;
			this.image.height = dimension;

		}

		const floatArray = this.image.data;

		const u = new Vector3();
		const v = new Vector3();
		const worldQuaternion = new Quaternion();

		for ( let i = 0, l = lights.length; i < l; i ++ ) {

			const l = lights[ i ];

			// position
			l.getWorldPosition( v );
			floatArray[ index ++ ] = v.x;
			floatArray[ index ++ ] = v.y;
			floatArray[ index ++ ] = v.z;
			index ++;

			// color
			floatArray[ index ++ ] = l.color.r;
			floatArray[ index ++ ] = l.color.g;
			floatArray[ index ++ ] = l.color.b;

			// intensity
			floatArray[ index ++ ] = l.intensity;

			// u vector
			l.getWorldQuaternion( worldQuaternion );
			u.set( l.width, 0, 0 ).applyQuaternion( worldQuaternion );
			floatArray[ index ++ ] = u.x;
			floatArray[ index ++ ] = u.y;
			floatArray[ index ++ ] = u.z;
			index ++;

			// v vector
			v.set( 0, l.height, 0 ).applyQuaternion( worldQuaternion );
			floatArray[ index ++ ] = v.x;
			floatArray[ index ++ ] = v.y;
			floatArray[ index ++ ] = v.z;

			// area
			floatArray[ index ++ ] = u.cross( v ).length();

		}

		this.needsUpdate = true;

	}

}
