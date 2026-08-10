import { Matrix4 } from 'three';
import { uniform, PI } from 'three/tsl';
import { wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { EquirectCamera } from '../../objects/EquirectCamera.js';

EquirectCamera.prototype.getCameraRayFn = function getCameraRayFn() {

	const cameraToWorld = uniform( new Matrix4() );
	const fn = wgslTagFn/* wgsl */`
		fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

			// screen uv to spherical direction, matching three.js' equirect orientation
			let theta = ( uv.x - 0.5 ) * 2.0 * ${ PI };
			let phi = ( 1.0 - uv.y ) * ${ PI };
			let sinPhi = sin( phi );
			let direction = vec3f( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

			// equirect ignores the projection - orient by the camera world matrix and place the origin
			ray.origin = ( ${ cameraToWorld } * vec4f( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
			ray.direction = ( ${ cameraToWorld } * vec4f( direction, 0.0 ) ).xyz;
			return true;

		}
	`;

	const update = () => {

		cameraToWorld.value.copy( this.matrixWorld );

	};

	return { fn, update };

};
