import { ArrayCamera, Matrix4, Vector4 } from 'three';
import { uniformArray } from 'three/tsl';
import { ndcToCameraRay, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';

ArrayCamera.prototype.getCameraRayFn = function getCameraRayFn() {

	const cameraCount = this.cameras.length;
	if ( cameraCount === 0 ) {

		throw new Error( 'ArrayCamera: At least one sub-camera is required.' );

	}

	const invViewProjectionMatrices = uniformArray(
		Array.from( { length: cameraCount }, () => new Matrix4() ),
		'mat4',
	);
	const viewports = uniformArray(
		Array.from( { length: cameraCount }, () => new Vector4() ),
		'vec4',
	);

	const fn = wgslTagFn/* wgsl */`
		fn getCameraRay( uv: vec2f, resolution: vec2f ) -> ${ rayStruct } {

			let pixel = uv * resolution;
			var cameraUv = uv;
			var cameraIndex = 0u;

			for ( var i = 0u; i < ${ cameraCount }u; i ++ ) {

				let viewport = ${ viewports }[ i ];
				let viewportMax = viewport.xy + viewport.zw;
				if ( all( pixel >= viewport.xy ) && all( pixel < viewportMax ) ) {

					cameraIndex = i;
					cameraUv = ( pixel - viewport.xy ) / viewport.zw;
					break;

				}

			}

			let ndc = cameraUv * 2.0 - vec2f( 1.0 );
			return ${ ndcToCameraRay }( ndc, ${ invViewProjectionMatrices }[ cameraIndex ] );

		}
	`;

	const update = () => {

		if ( this.cameras.length !== cameraCount ) {

			throw new Error( 'ArrayCamera: Call WebGPUPathTracer.setCamera() after changing the number of sub-cameras.' );

		}

		for ( let i = 0; i < cameraCount; i ++ ) {

			const camera = this.cameras[ i ];
			const viewport = camera.viewport;
			if ( viewport === undefined || viewport.z <= 0 || viewport.w <= 0 ) {

				throw new Error( 'ArrayCamera: Each sub-camera must define a non-empty viewport.' );

			}

			camera.updateMatrixWorld();
			invViewProjectionMatrices.array[ i ].multiplyMatrices( camera.matrixWorld, camera.projectionMatrixInverse );
			viewports.array[ i ].copy( viewport );

		}

	};

	return { fn, update };

};
