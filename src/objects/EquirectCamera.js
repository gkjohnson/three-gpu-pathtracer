import { Camera } from 'three';
import { uniform } from 'three/tsl';
import { wgslTagFn, rayStruct } from '../../../three-mesh-bvh/src/webgpu/index.js';

export class EquirectCamera extends Camera {

	constructor() {

		super();

		this.isEquirectCamera = true;

	}

	getCameraRayFn() {

		const cameraToWorld = uniform( this.matrixWorld );

		return wgslTagFn/* wgsl */`
			fn getCameraRay( uv: vec2f, resolution: vec2f ) -> ${ rayStruct } {

				let PI = 3.141592653589793;

				// screen uv to spherical direction, matching three.js' equirect orientation
				let theta = ( uv.x - 0.5 ) * 2.0 * PI;
				let phi = ( 1.0 - uv.y ) * PI;
				let sinPhi = sin( phi );
				let direction = vec3f( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

				// equirect ignores the projection - orient by the camera world matrix and place the origin
				var ray: ${ rayStruct };
				ray.origin = ( ${ cameraToWorld } * vec4f( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
				ray.direction = ( ${ cameraToWorld } * vec4f( direction, 0.0 ) ).xyz;
				return ray;

			}
		`;

	}

}
