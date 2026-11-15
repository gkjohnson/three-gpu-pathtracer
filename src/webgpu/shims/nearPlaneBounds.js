import { Vector3 } from 'three';

const _corner = /* @__PURE__ */ new Vector3();

// Expands the bounds by the corners of a perspective or orthographic camera's near plane, where its rays start, in the
// camera's local space or transformed by the given matrix
export function expandByNearPlane( camera, target, matrix = null ) {

	// the near plane's depth in the camera's clip space
	const nearDepth = _corner.set( 0, 0, - camera.near ).applyMatrix4( camera.projectionMatrix ).z;
	for ( let x = - 1; x <= 1; x += 2 ) {

		for ( let y = - 1; y <= 1; y += 2 ) {

			_corner.set( x, y, nearDepth ).applyMatrix4( camera.projectionMatrixInverse );
			if ( matrix ) {

				_corner.applyMatrix4( matrix );

			}

			target.expandByPoint( _corner );

		}

	}

	return target;

}
