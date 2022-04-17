import { PhysicalCamera } from '../core/PhysicalCamera.js';
export class PhysicalCameraUniform {

	constructor() {

		this.focalLength = 0;
		this.apertureBlades = 0;
		this.fStop = 0;
		this.focusDistance = 10;
		this.anamorphicRatio = 1;

	}

	updateFrom( camera ) {

		this.focalLength = camera.getFocalLength();
		if ( camera instanceof PhysicalCamera ) {

			this.apertureBlades = camera.apertureBlades;
			this.fStop = camera.fStop;
			this.focusDistance = camera.focusDistance;
			this.anamorphicRatio = camera.focusDistance;

		} else {

			this.apertureBlades = 0;
			this.fStop = 0;
			this.focusDistance = 10;
			this.anamorphicRatio = 1;

		}

	}

}
