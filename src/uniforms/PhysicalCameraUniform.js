import { PhysicalCamera } from '../core/PhysicalCamera.js';
export class PhysicalCameraUniform {

	constructor() {

		this.focalLength = 0;
		this.apertureBlades = 0;
		this.fStop = 0;

		// TODO: is this needed? or a function of fStop?
		this.focalPlane = 0;

	}

	updateFrom( camera ) {

		this.focalLength = camera.getFocalLength();
		if ( camera instanceof PhysicalCamera ) {

			this.apertureBlades = camera.apertureBlades;
			this.fStop = camera.fStop;

		} else {

			this.apertureBlades = 0;
			this.fStop = 0;

		}

	}

}
