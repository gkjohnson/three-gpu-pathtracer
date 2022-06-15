import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, Vector3, Matrix4, Quaternion } from 'three';

const LIGHT_PIXELS = 6;

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
			floatArray[ baseIndex + ( index ++ ) ] = l.isRectAreaLight ? 0 : ( l.isSpotLight ? 1 : - 1 );

			// color
			floatArray[ baseIndex + ( index ++ ) ] = l.color.r;
			floatArray[ baseIndex + ( index ++ ) ] = l.color.g;
			floatArray[ baseIndex + ( index ++ ) ] = l.color.b;

			// intensity
			floatArray[ baseIndex + ( index ++ ) ] = l.intensity;

			if ( l.isRectAreaLight ) {

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
				floatArray[ baseIndex + ( index ++ ) ] = u.cross( v ).length();

			} else if ( l.isSpotLight ) {

				const eye = new Vector3();
				eye.setFromMatrixPosition( l.matrixWorld );

				const target = new Vector3();
				target.setFromMatrixPosition( l.target.matrixWorld );

				const up = new Vector3();

				var m = new Matrix4();
				m.lookAt( eye, target, up );

				worldQuaternion.setFromRotationMatrix( m );

				// u vector
				u.set( 1, 0, 0 ).applyQuaternion( worldQuaternion );

				floatArray[ baseIndex + ( index ++ ) ] = u.x;
				floatArray[ baseIndex + ( index ++ ) ] = u.y;
				floatArray[ baseIndex + ( index ++ ) ] = u.z;
				index ++;

				// v vector
				v.set( 0, 1, 0 ).applyQuaternion( worldQuaternion );

				floatArray[ baseIndex + ( index ++ ) ] = v.x;
				floatArray[ baseIndex + ( index ++ ) ] = v.y;
				floatArray[ baseIndex + ( index ++ ) ] = v.z;

				const radius = l.radius;

				// area
				floatArray[ baseIndex + ( index ++ ) ] = Math.PI * radius * radius;

				// radius
				floatArray[ baseIndex + ( index ++ ) ] = radius;

				// near
				floatArray[ baseIndex + ( index ++ ) ] = l.shadow.camera.near;

				// decay
				floatArray[ baseIndex + ( index ++ ) ] = l.decay;

				// distance
				floatArray[ baseIndex + ( index ++ ) ] = l.distance;

				// coneCos
				floatArray[ baseIndex + ( index ++ ) ] = Math.cos( l.angle );

				// penumbraCos
				floatArray[ baseIndex + ( index ++ ) ] = Math.cos( l.angle * ( 1 - l.penumbra ) );

				// lampIntensityScale
				floatArray[ baseIndex + ( index ++ ) ] = l.lampIntensityScale;

				// iesProfile
				floatArray[ baseIndex + ( index ++ ) ] = l.iesProfile;

			}

		}

		this.needsUpdate = true;

	}

}
