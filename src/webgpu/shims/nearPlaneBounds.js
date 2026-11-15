import { Vector3 } from 'three';

const _corner = /* @__PURE__ */ new Vector3();

// Expands the bounds by the corners of a perspective or orthographic camera's near plane, where its rays start, in the
// camera's local space or transformed by the given matrix. As in "ndcToCameraRay", the near plane is at the zero depth
// of the WebGPU clip space the camera ray functions set the cameras to
export function expandByNearPlane( camera, target, matrix = null ) {

	for ( let x = - 1; x <= 1; x += 2 ) {

		for ( let y = - 1; y <= 1; y += 2 ) {

			_corner.set( x, y, 0 ).applyMatrix4( camera.projectionMatrixInverse );
			if ( matrix ) {

				_corner.applyMatrix4( matrix );

			}

			target.expandByPoint( _corner );

		}

	}

	return target;

}
