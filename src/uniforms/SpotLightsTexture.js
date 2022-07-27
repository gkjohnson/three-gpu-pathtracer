import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, Vector3, Matrix4, Quaternion } from 'three';

const SPOT_LIGHT_PIXELS = 6;

export class SpotLightsTexture extends DataTexture {

	constructor() {

		super( new Float32Array( 4 ), 1, 1 );

		this.format = RGBAFormat;
		this.type = FloatType;
		this.wrapS = ClampToEdgeWrapping;
		this.wrapT = ClampToEdgeWrapping;
		this.generateMipmaps = false;

	}

	updateFrom( spotLights, iesTextures = [] ) {

		const pixelCount = spotLights.length * SPOT_LIGHT_PIXELS;
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

		for ( let i = 0, l = spotLights.length; i < l; i ++ ) {

			const sl = spotLights[ i ];

			const baseIndex = i * SPOT_LIGHT_PIXELS * 4;
			let index = 0;

		    // position
			sl.getWorldPosition( v );
			floatArray[ baseIndex + ( index ++ ) ] = v.x;
			floatArray[ baseIndex + ( index ++ ) ] = v.y;
			floatArray[ baseIndex + ( index ++ ) ] = v.z;

			// type
			floatArray[ baseIndex + ( index ++ ) ] = - 1;

			// color
			floatArray[ baseIndex + ( index ++ ) ] = sl.color.r;
			floatArray[ baseIndex + ( index ++ ) ] = sl.color.g;
			floatArray[ baseIndex + ( index ++ ) ] = sl.color.b;

			// intensity
			floatArray[ baseIndex + ( index ++ ) ] = sl.intensity;

			const eye = new Vector3();
			eye.setFromMatrixPosition( sl.matrixWorld );

			const target = new Vector3();
			target.setFromMatrixPosition( sl.target.matrixWorld );

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

			const radius = sl.radius;

			// area
			floatArray[ baseIndex + ( index ++ ) ] = Math.PI * radius * radius;

			// radius
			floatArray[ baseIndex + ( index ++ ) ] = radius;

			// near
			floatArray[ baseIndex + ( index ++ ) ] = sl.shadow.camera.near;

			// decay
			floatArray[ baseIndex + ( index ++ ) ] = sl.decay;

			// distance
			floatArray[ baseIndex + ( index ++ ) ] = sl.distance;

			// coneCos
			floatArray[ baseIndex + ( index ++ ) ] = Math.cos( sl.angle );

			// penumbraCos
			floatArray[ baseIndex + ( index ++ ) ] = Math.cos( sl.angle * ( 1 - sl.penumbra ) );

			console.log( iesTextures );
			// iesProfile
			floatArray[ baseIndex + ( index ++ ) ] = iesTextures.indexOf( sl.iesTexture );

		}

		this.needsUpdate = true;

	}

}
