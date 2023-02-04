import { PerspectiveCamera, Vector3, MathUtils } from 'three';
import { PathTracingRenderer } from './PathTracingRenderer.js';

export class LKGPathTracingRenderer extends PathTracingRenderer {

	constructor( ...args ) {

		super( ...args );

		this.viewCount = 30;
		this.viewCone = 35 * MathUtils.DEG2RAD;
		this.viewDistance = 1;
		this.viewFoV = 14;
		this.viewAspect = 0.75;
		this._camera = new PerspectiveCamera();
		this._lkgTask = null;

	}

	*_task() {

		const step = new Vector3();
		while ( true ) {

			const {
				viewCount,
				viewCone,
				viewDistance,
				viewFoV,
				viewAspect,
				_camera,
			} = this;

			const halfWidth = Math.atan( viewCone ) / viewDistance;
			const totalWidth = halfWidth * 2.0;
			const stride = totalWidth / ( viewCount - 1 );

			for ( let i = 0; i < viewCount || 1; i ++ ) {

				// step from left to right
				step
					.set( 1, 0, 0 )
					.applyQuaternion( this.camera.quaternion );
				_camera
					.quaternion
					.copy( this.camera.quaternion );
				_camera
					.position
					.copy( this.camera.position ).addScaledVector( step, - halfWidth + stride * i );
				_camera.updateMatrixWorld();

				// TODO: set up projection matrix

				// TODO: set up subframe

				while ( this.samples % 1 !== 0 ) {

					const ogCamera = this.camera;
					this.camera = _camera;
					super.update();
					this.camera = ogCamera;
					yield;


				}

			}

		}

	}

	update() {

		if ( ! this._lkgTask ) {

			this._lkgTask = this._task();

		}

		this._lkgTask.next();

	}

}
