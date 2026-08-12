import { ArrayCamera, Matrix4, Vector4, WebGPUCoordinateSystem } from 'three';
import { uniformArray, int } from 'three/tsl';
import { ndcToCameraRay, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';

ArrayCamera.prototype.getCameraRayFn = function getCameraRayFn() {

	const result = { fn: null, update: null };

	const cameraCount = int( 0 );
	const invViewProjectionMatrices = uniformArray( [], 'mat4' );
	const viewports = uniformArray( [], 'vec4' );

	result.fn = wgslTagFn/* wgsl */`
		fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

			let pixel = uv * resolution;

			for ( var i = 0u; i < ${ cameraCount }u; i ++ ) {

				let viewport = ${ viewports }[ i ];
				let viewportMax = viewport.xy + viewport.zw;
				if ( all( pixel >= viewport.xy ) && all( pixel < viewportMax ) ) {

					let cameraUv = ( pixel - viewport.xy ) / viewport.zw;
					let ndc = cameraUv * 2.0 - vec2f( 1.0 );
					*ray = ${ ndcToCameraRay }( ndc, ${ invViewProjectionMatrices }[ i ] );
					return true;

				}

			}

			return false;

		}
	`;

	result.update = () => {

		const { cameras } = this;
		const needsRebuild = cameraCount.node.value !== cameras.length;
		cameraCount.node.value = cameras.length;

		while ( viewports.array.length < cameras.length ) {

			viewports.array.push( new Vector4() );
			invViewProjectionMatrices.array.push( new Matrix4() );

		}

		invViewProjectionMatrices.array.length = cameras.length;
		viewports.array.length = cameras.length;

		for ( let i = 0; i < cameras.length; i ++ ) {

			const camera = cameras[ i ];
			const viewport = camera.viewport;

			camera.coordinateSystem = WebGPUCoordinateSystem;
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			invViewProjectionMatrices.array[ i ].multiplyMatrices( camera.matrixWorld, camera.projectionMatrixInverse );
			viewports.array[ i ].copy( viewport );

		}

		return needsRebuild;

	};

	result.update();

	return result;

};
