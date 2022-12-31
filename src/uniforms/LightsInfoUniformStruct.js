import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, Vector3, Quaternion, Matrix4 } from 'three';

const LIGHT_PIXELS = 6;
const RECT_AREA_LIGHT = 0;
const CIRC_AREA_LIGHT = 1;
const SPOT_LIGHT = 2;
const DIR_LIGHT = 3;
const POINT_LIGHT = 4;
export class LightsInfoUniformStruct {

	constructor() {

		const tex = new DataTexture( new Float32Array( 4 ), 1, 1 );
		tex.format = RGBAFormat;
		tex.type = FloatType;
		tex.wrapS = ClampToEdgeWrapping;
		tex.wrapT = ClampToEdgeWrapping;
		tex.generateMipmaps = false;

		this.tex = tex;
		this.count = 0;

	}

	updateFrom( lights, iesTextures = [] ) {

		const tex = this.tex;
		const pixelCount = Math.max( lights.length * LIGHT_PIXELS, 1 );
		const dimension = Math.ceil( Math.sqrt( pixelCount ) );

		if ( tex.image.width !== dimension ) {

			tex.dispose();

			tex.image.data = new Float32Array( dimension * dimension * 4 );
			tex.image.width = dimension;
			tex.image.height = dimension;

		}

		const floatArray = tex.image.data;

		const u = new Vector3();
		const v = new Vector3();
		const m = new Matrix4();
		const worldQuaternion = new Quaternion();
		const eye = new Vector3();
		const target = new Vector3();
		const up = new Vector3();

		for ( let i = 0, l = lights.length; i < l; i ++ ) {

			const l = lights[ i ];

			const baseIndex = i * LIGHT_PIXELS * 4;
			let index = 0;

			// sample 1
		    // position
			l.getWorldPosition( v );
			floatArray[ baseIndex + ( index ++ ) ] = v.x;
			floatArray[ baseIndex + ( index ++ ) ] = v.y;
			floatArray[ baseIndex + ( index ++ ) ] = v.z;

			// type
			let type = RECT_AREA_LIGHT;
			if ( l.isRectAreaLight && l.isCircular ) {

				type = CIRC_AREA_LIGHT;

			} else if ( l.isSpotLight ) {

				type = SPOT_LIGHT;

			} else if ( l.isDirectionalLight ) {

				type = DIR_LIGHT;

			} else if ( l.isPointLight ) {

				type = POINT_LIGHT;

			}

			floatArray[ baseIndex + ( index ++ ) ] = type;

			// sample 2
			// color
			floatArray[ baseIndex + ( index ++ ) ] = l.color.r;
			floatArray[ baseIndex + ( index ++ ) ] = l.color.g;
			floatArray[ baseIndex + ( index ++ ) ] = l.color.b;

			// intensity
			floatArray[ baseIndex + ( index ++ ) ] = l.intensity;

			l.getWorldQuaternion( worldQuaternion );

			if ( l.isRectAreaLight ) {

				// sample 3
				// u vector
				u.set( l.width, 0, 0 ).applyQuaternion( worldQuaternion );

				floatArray[ baseIndex + ( index ++ ) ] = u.x;
				floatArray[ baseIndex + ( index ++ ) ] = u.y;
				floatArray[ baseIndex + ( index ++ ) ] = u.z;
				index ++;

				// sample 4
				// v vector
				v.set( 0, l.height, 0 ).applyQuaternion( worldQuaternion );

				floatArray[ baseIndex + ( index ++ ) ] = v.x;
				floatArray[ baseIndex + ( index ++ ) ] = v.y;
				floatArray[ baseIndex + ( index ++ ) ] = v.z;

				// area
				floatArray[ baseIndex + ( index ++ ) ] = u.cross( v ).length() * ( l.isCircular ? ( Math.PI / 4.0 ) : 1.0 );

			} else if ( l.isSpotLight ) {

				const radius = l.radius;
				eye.setFromMatrixPosition( l.matrixWorld );
				target.setFromMatrixPosition( l.target.matrixWorld );
				m.lookAt( eye, target, up );
				worldQuaternion.setFromRotationMatrix( m );

				// sample 3
				// u vector
				u.set( 1, 0, 0 ).applyQuaternion( worldQuaternion );

				floatArray[ baseIndex + ( index ++ ) ] = u.x;
				floatArray[ baseIndex + ( index ++ ) ] = u.y;
				floatArray[ baseIndex + ( index ++ ) ] = u.z;
				index ++;

				// sample 4
				// v vector
				v.set( 0, 1, 0 ).applyQuaternion( worldQuaternion );

				floatArray[ baseIndex + ( index ++ ) ] = v.x;
				floatArray[ baseIndex + ( index ++ ) ] = v.y;
				floatArray[ baseIndex + ( index ++ ) ] = v.z;

				// area
				floatArray[ baseIndex + ( index ++ ) ] = Math.PI * radius * radius;

				// sample 5
				// radius
				floatArray[ baseIndex + ( index ++ ) ] = radius;

				// near
				floatArray[ baseIndex + ( index ++ ) ] = l.shadow.camera.near;

				// decay
				floatArray[ baseIndex + ( index ++ ) ] = l.decay;

				// distance
				floatArray[ baseIndex + ( index ++ ) ] = l.distance;

				// sample 6
				// coneCos
				floatArray[ baseIndex + ( index ++ ) ] = Math.cos( l.angle );

				// penumbraCos
				floatArray[ baseIndex + ( index ++ ) ] = Math.cos( l.angle * ( 1 - l.penumbra ) );

				// iesProfile
				floatArray[ baseIndex + ( index ++ ) ] = iesTextures.indexOf( l.iesTexture );

			} else if ( l.isPointLight ) {

				const worldPosition = l.getWorldPosition( u );
				floatArray[ baseIndex + ( index ++ ) ] = worldPosition.x;
				floatArray[ baseIndex + ( index ++ ) ] = worldPosition.y;
				floatArray[ baseIndex + ( index ++ ) ] = worldPosition.z;
				index ++;

				// sample 4
				index += 4;

				// sample 5
				index += 2;

				floatArray[ baseIndex + ( index ++ ) ] = l.decay;
				floatArray[ baseIndex + ( index ++ ) ] = l.distance;

			} else if ( l.isDirectionalLight ) {

				const worldPosition = l.getWorldPosition( u );
				const targetPosition = l.target.getWorldPosition( v );

				target.subVectors( worldPosition, targetPosition ).normalize();
				floatArray[ baseIndex + ( index ++ ) ] = target.x;
				floatArray[ baseIndex + ( index ++ ) ] = target.y;
				floatArray[ baseIndex + ( index ++ ) ] = target.z;

			}

		}

		tex.needsUpdate = true;
		this.count = lights.length;

	}

}
