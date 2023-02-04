import { PerspectiveCamera, Vector3, MathUtils, Vector2 } from 'three';
import { PathTracingRenderer } from './PathTracingRenderer.js';

const _step = new Vector3();
function* _task( cb ) {

	while ( true ) {

		const {
			viewCount,
			_camera,
		} = this;

		for ( let i = 0; i < viewCount; i ++ ) {

			// step from left to right
			this._setCameraTransform( i );
			this._setQuiltFrame( i );
			this._opacityFactor = Math.floor( this._samples + 1 ) / Math.floor( this._quiltSamples + 1 );

			do {

				const ogCamera = this.camera;
				this.camera = _camera;
				cb();
				this.camera = ogCamera;
				yield;

			} while ( this._samples % 1 !== 0 );

			this._quiltSamples += 1 / viewCount;

		}

	}

}

export class QuiltPathTracingRenderer extends PathTracingRenderer {

	get viewCount() {

		return this.quiltDimensions.x * this.quiltDimensions.y;

	}

	get samples() {

		return this._quiltSamples + ( ( this._samples % 1 ) / this.viewCount );

	}

	constructor( ...args ) {

		super( ...args );

		this.quiltDimensions = new Vector2( 8, 6 );
		this.viewCone = 35 * MathUtils.DEG2RAD;
		this.viewFoV = 14 * MathUtils.DEG2RAD;
		this.viewDistance = 1;
		this.viewAspect = 0.75;
		this._quiltSamples = 0;
		this._camera = new PerspectiveCamera();
		this._quiltTask = null;

	}

	_setQuiltFrame( i ) {

		const { quiltDimensions } = this;
		const x = i % quiltDimensions.x;
		const y = Math.floor( i / quiltDimensions.x );

		const qw = 1 / quiltDimensions.x;
		const qh = 1 / quiltDimensions.y;
		this._subframe.set( x * qw, y * qh, qw, qh );

	}

	_setCameraTransform( i ) {

		const { _camera, viewCone, viewDistance, viewCount, viewFoV, viewAspect } = this;
		const halfWidth = Math.tan( 0.5 * viewCone ) * viewDistance;
		const totalWidth = halfWidth * 2.0;
		const stride = totalWidth / ( viewCount - 1 );

		// set camera offset
		const offset = - halfWidth + stride * i;
		_step
			.set( 1, 0, 0 )
			.applyQuaternion( this.camera.quaternion );
		_camera
			.quaternion
			.copy( this.camera.quaternion );
		_camera
			.position
			.copy( this.camera.position )
			.addScaledVector( _step, offset );
		_camera.updateMatrixWorld();

		// set the projection matrix
		const displayHalfHeight = Math.tan( viewFoV * 0.5 ) * viewDistance;
		const displayHalfWidth = viewAspect * displayHalfHeight;
		const { near, far } = this.camera;
		const nearScale = near / viewDistance;

		_camera
			.projectionMatrix
			.makePerspective(
				nearScale * ( - displayHalfWidth - offset ), nearScale * ( displayHalfWidth - offset ),
				nearScale * displayHalfHeight, nearScale * - displayHalfHeight,
				near, far,
			);

		_camera
			.projectionMatrixInverse
			.copy( _camera.projectionMatrix )
			.invert();

	}

	setFromDisplayView( distance, width, height ) {

		this.viewAspect = width / height;
		this.viewDistance = distance;
		this.viewFoV = 2.0 * Math.atan( 0.5 * height / distance );

	}

	update() {

		this.alpha = false;
		this._opacityFactor = this.viewCount;
		if ( ! this._quiltTask ) {

			this._quiltTask = _task.call( this, () => {

				super.update();

			} );

		}

		this._quiltTask.next();

	}

	reset() {

		super.reset();
		this._quiltTask = null;
		this._quiltSamples = 0;

	}

}
