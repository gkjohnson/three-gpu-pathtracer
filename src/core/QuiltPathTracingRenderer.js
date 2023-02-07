import { PerspectiveCamera, Vector3, MathUtils, Vector2, Matrix4, Vector4 } from 'three';
import { PathTracingRenderer } from './PathTracingRenderer.js';

function* _task( cb ) {

	const {
		viewCount,
		_camera,
		_quiltUtility,
		_subframe,
	} = this;

	const quiltViewInfo = {
		subframe: _subframe,
		projectionMatrix: _camera.projectionMatrix,
		offsetDirection: new Vector3(),
	};

	while ( true ) {

		for ( let i = 0; i < viewCount; i ++ ) {

			// get the camera info for the current view index
			_quiltUtility.near = this.camera.near;
			_quiltUtility.far = this.camera.far;
			_quiltUtility.getCameraViewInfo( i, quiltViewInfo );

			// transform offset into world frame from camera frame
			quiltViewInfo.offsetDirection.transformDirection( this.camera.matrixWorld );

			// adjust the render camera with the view offset
			this.camera.matrixWorld.decompose(
				_camera.position,
				_camera.quaternion,
				_camera.scale,
			);
			_camera.position.addScaledVector( quiltViewInfo.offsetDirection, quiltViewInfo.offset );
			_camera.updateMatrixWorld();

			// get the inverse projection
			_camera.projectionMatrixInverse
				.copy( _camera.projectionMatrix )
				.invert();

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

		this._quiltSamples = Math.round( this._quiltSamples );

	}

}

// Helper for extracting the camera projection, offset, and quilt subframe needed
// for rendering a quilt with the provided parameters.
class QuiltViewUtility {

	constructor() {

		this.viewCount = 48;
		this.quiltDimensions = new Vector2( 8, 6 );
		this.viewCone = 35 * MathUtils.DEG2RAD;
		this.viewFoV = 14 * MathUtils.DEG2RAD;
		this.displayDistance = 1;
		this.displayAspect = 0.75;
		this.near = 0.01;
		this.far = 10;

	}

	getCameraViewInfo( i, target = {} ) {

		const {
			quiltDimensions,
			viewCone,
			displayDistance,
			viewCount,
			viewFoV,
			displayAspect,
			near,
			far,
		} = this;

		// initialize defaults
		target.subframe = target.subframe || new Vector4();
		target.offsetDirection = target.offsetDirection || new Vector3();
		target.projectionMatrix	= target.projectionMatrix || new Matrix4();

		// set camera offset
		const halfWidth = Math.tan( 0.5 * viewCone ) * displayDistance;
		const totalWidth = halfWidth * 2.0;
		const stride = totalWidth / ( viewCount - 1 );
		const offset = viewCount === 1 ? 0 : - halfWidth + stride * i;
		target.offsetDirection.set( 1.0, 0, 0 );
		target.offset = offset;

		// set the projection matrix
		const displayHalfHeight = Math.tan( viewFoV * 0.5 ) * displayDistance;
		const displayHalfWidth = displayAspect * displayHalfHeight;
		const nearScale = near / displayDistance;

		target.projectionMatrix.makePerspective(
			nearScale * ( - displayHalfWidth - offset ), nearScale * ( displayHalfWidth - offset ),
			nearScale * displayHalfHeight, nearScale * - displayHalfHeight,
			near, far,
		);

		// set the quilt subframe
		const x = i % quiltDimensions.x;
		const y = Math.floor( i / quiltDimensions.x );

		const qw = 1 / quiltDimensions.x;
		const qh = 1 / quiltDimensions.y;
		target.subframe.set( x * qw, y * qh, qw, qh );

		return target;

	}

	setFromDisplayView( viewerDistance, displayWidth, displayHeight ) {

		this.displayAspect = displayWidth / displayHeight;
		this.displayDistance = viewerDistance;
		this.viewFoV = 2.0 * Math.atan( 0.5 * displayHeight / viewerDistance );

	}

}

export class QuiltPathTracingRenderer extends PathTracingRenderer {

	get samples() {

		return this._samples / this.viewCount;

	}

	constructor( ...args ) {

		super( ...args );

		[
			'quiltDimensions',
			'viewCount',
			'viewCone',
			'viewFoV',
			'displayDistance',
			'displayAspect',
		].forEach( member => {

			Object.defineProperty( this, member, {

				enumerable: true,

				set: v => {

					this._quiltUtility[ member ] = v;

				},

				get: () => {

					return this._quiltUtility[ member ];

				}

			} );

		} );


		this._quiltUtility = new QuiltViewUtility();
		this._quiltSamples = 0;
		this._camera = new PerspectiveCamera();
		this._quiltTask = null;

	}

	setFromDisplayView( ...args ) {

		this._quiltUtility.setFromDisplayView( ...args );

	}

	update() {

		this.alpha = false;
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
