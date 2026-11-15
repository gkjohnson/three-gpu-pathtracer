import { Vector3 } from 'three';

const _corner = /* @__PURE__ */ new Vector3();

// Expands the bounds by the camera's near plane corners, where its rays start, in camera space or transformed by the
// matrix. The cameras use WebGPU clip space, so the near plane is at zero depth as in "ndcToCameraRay"
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
