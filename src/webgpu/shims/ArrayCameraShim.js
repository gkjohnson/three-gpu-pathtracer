import { ArrayCamera, Matrix4, Vector4, WebGPUCoordinateSystem } from 'three';
import { uniformArray } from 'three/tsl';
import { ndcToCameraRay, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';

ArrayCamera.prototype.getCameraRayFn = function getCameraRayFn() {

	let cameraCount = 0;
	let invViewProjectionMatrices;
	let viewports;
	const result = { fn: null, update: null };

	const rebuild = () => {

		cameraCount = this.cameras.length;
		if ( cameraCount === 0 ) {

			result.fn = wgslTagFn/* wgsl */`
				fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

					return false;

				}
			`;
			return;

		}

		invViewProjectionMatrices = uniformArray(
			Array.from( { length: cameraCount }, () => new Matrix4() ),
			'mat4',
		);
		viewports = uniformArray(
			Array.from( { length: cameraCount }, () => new Vector4() ),
			'vec4',
		);

		result.fn = wgslTagFn/* wgsl */`
			fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

				let pixel = uv * resolution;

				for ( var i = 0u; i < ${ cameraCount }u; i ++ ) {

					let viewport = ${ viewports }[ i ];
					let viewportMax = viewport.xy + viewport.zw;
					if ( all( pixel >= viewport.xy ) && all( pixel < viewportMax ) ) {

						let cameraUv = ( pixel - viewport.xy ) / viewport.zw;
						let ndc = cameraUv * 2.0 - vec2f( 1.0 );
						let cameraRay = ${ ndcToCameraRay }( ndc, ${ invViewProjectionMatrices }[ i ] );
						ray.origin = cameraRay.origin;
						ray.direction = cameraRay.direction;
						return true;

					}

				}

				return false;

			}
		`;

	};

	result.update = () => {

		let needsRebuild = false;
		if ( this.cameras.length !== cameraCount ) {

			rebuild();
			needsRebuild = true;

		}

		for ( let i = 0; i < cameraCount; i ++ ) {

			const camera = this.cameras[ i ];
			const viewport = camera.viewport;

			camera.coordinateSystem = WebGPUCoordinateSystem;
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();
			invViewProjectionMatrices.array[ i ].multiplyMatrices( camera.matrixWorld, camera.projectionMatrixInverse );
			viewports.array[ i ].copy( viewport );

		}

		return needsRebuild;

	};

	rebuild();
	return result;

};
