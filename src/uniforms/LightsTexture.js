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

			const baseIndex = i * LIGHT_PIXELS * 4;
			let index = 0;

		    // position
			l.getWorldPosition( v );
			floatArray[ baseIndex + ( index ++ ) ] = v.x;
			floatArray[ baseIndex + ( index ++ ) ] = v.y;
			floatArray[ baseIndex + ( index ++ ) ] = v.z;

			// type
			floatArray[ baseIndex + ( index ++ ) ] = l.isCircular ? 1 : 0;

			// color
			floatArray[ baseIndex + ( index ++ ) ] = l.color.r;
			floatArray[ baseIndex + ( index ++ ) ] = l.color.g;
			floatArray[ baseIndex + ( index ++ ) ] = l.color.b;

			// intensity
			floatArray[ baseIndex + ( index ++ ) ] = l.intensity;

			l.getWorldQuaternion( worldQuaternion );

			// u vector
			u.set( l.width, 0, 0 ).applyQuaternion( worldQuaternion );

			floatArray[ baseIndex + ( index ++ ) ] = u.x;
			floatArray[ baseIndex + ( index ++ ) ] = u.y;
			floatArray[ baseIndex + ( index ++ ) ] = u.z;
			index ++;

			// v vector
			v.set( 0, l.height, 0 ).applyQuaternion( worldQuaternion );

			floatArray[ baseIndex + ( index ++ ) ] = v.x;
			floatArray[ baseIndex + ( index ++ ) ] = v.y;
			floatArray[ baseIndex + ( index ++ ) ] = v.z;

			// area
			floatArray[ baseIndex + ( index ++ ) ] = u.cross( v ).length() * ( l.isCircular ? ( Math.PI / 4.0 ) : 1.0 );

		}

		this.needsUpdate = true;

	}

}
