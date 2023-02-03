import { PerspectiveCamera } from 'three';
import { PathTracingRenderer } from './PathTracingRenderer.js';

export class LKGPathTracingRenderer extends PathTracingRenderer {

	constructor( ...args ) {

		super( ...args );

		this.viewCount = 30;
		this.viewCone = 35;
		this.viewDistance = 1;
		this.viewFoV = 14;
		this._camera = new PerspectiveCamera();
		this._lkgTask = null;

	}

	*_task() {

		while ( true ) {

			const { viewCount, viewCone, viewFoV, viewDistance, _camera } = this;
			for ( let i = 0; i < viewCount || 1; i ++ ) {

				// TODO:
				// - prep camera position
				// - prep subframe

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
