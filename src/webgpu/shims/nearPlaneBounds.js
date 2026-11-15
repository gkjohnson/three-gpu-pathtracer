import { Vector3 } from 'three';

const _corner = /* @__PURE__ */ new Vector3();

// Expands the bounds by the corners of a perspective or orthographic camera's near plane, where its rays start
export function expandByNearPlane( camera, target ) {

	// the near plane's depth in the camera's clip space
	const nearDepth = _corner.set( 0, 0, - camera.near ).applyMatrix4( camera.projectionMatrix ).z;
	for ( let x = - 1; x <= 1; x += 2 ) {

		for ( let y = - 1; y <= 1; y += 2 ) {

			target.expandByPoint( _corner.set( x, y, nearDepth ).unproject( camera ) );

		}

	}

	return target;

}
