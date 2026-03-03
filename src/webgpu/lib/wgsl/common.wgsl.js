import { wgslFn, uint, float } from 'three/tsl';
import { rayStruct } from './structs.wgsl.js';

export const constants = {
	BVH_STACK_DEPTH: uint( 60 ),
	INFINITY: float( 1e20 ),
};

export const ndcToCameraRay = wgslFn( /* wgsl*/`

	fn ndcToCameraRay( ndc: vec2f, inverseModelViewProjection: mat4x4f ) -> Ray {

		// Calculate the ray by picking the points at the near and far plane and deriving the ray
		// direction from the two points. This approach works for both orthographic and perspective
		// camera projection matrices.
		// The returned ray direction is not normalized and extends to the camera far plane.
		var homogeneous = vec4f();
		var ray = Ray();

		homogeneous = inverseModelViewProjection * vec4f( ndc, 0.0, 1.0 );
		ray.origin = homogeneous.xyz / homogeneous.w;

		homogeneous = inverseModelViewProjection * vec4f( ndc, 1.0, 1.0 );
		ray.direction = ( homogeneous.xyz / homogeneous.w ) - ray.origin;

		return ray;

	}
`, [ rayStruct ] );
