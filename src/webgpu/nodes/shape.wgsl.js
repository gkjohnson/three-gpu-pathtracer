import { wgslFn } from '../lib/nodes/WGSLTagFnNode';

// Finds the point where the ray intersects the plane defined by u and v and checks if this point
// falls in the bounds of the rectangle on that same plane.
// Plane intersection: https://lousodrome.net/blog/light/2020/07/03/intersection-of-a-ray-and-a-plane/
export const intersectsRectangleFunc = wgslFn( /* wgsl */`

	fn intersectsRectangle(
		center: vec3f,
		normal: vec3f,
		u: vec3f,
		v: vec3f,
		rayOrigin: vec3f,
		rayDirection: vec3f,
		dist: ptr<function, f32>
	) -> bool {

		var didHit = false;
		let t = dot( center - rayOrigin, normal ) / dot( rayDirection, normal );

		if ( t > EPSILON ) {

			let p = rayOrigin + rayDirection * t;
			let vi = p - center;

			let a1 = dot( u, vi );
			if ( abs( a1 ) <= 0.5 ) {

				let a2 = dot( v, vi );
				if ( abs( a2 ) <= 0.5 ) {

					*dist = t;
					didHit = true;

				}

			}

		}

		return didHit;

	}

` );

// Finds the point where the ray intersects the plane defined by u and v and checks if this point
// falls in the bounds of the circle on that same plane. See above URL for a description of the plane intersection algorithm.
export const intersectsCircleFunc = wgslFn( /* wgsl */`

	fn intersectsCircle(
		position: vec3f,
		normal: vec3f,
		u: vec3f,
		v: vec3f,
		rayOrigin: vec3f,
		rayDirection: vec3f,
		dist: ptr<function, f32>
	) -> bool {

		var didHit = false;
		let t = dot( position - rayOrigin, normal ) / dot( rayDirection, normal );

		if ( t > EPSILON ) {

			let hit = rayOrigin + rayDirection * t;
			let vi = hit - position;

			let a1 = dot( u, vi );
			let a2 = dot( v, vi );

			if ( length( vec2( a1, a2 ) ) <= 0.5 ) {

				*dist = t;
				didHit = true;

			}

		}

		return didHit;

	}

` );

