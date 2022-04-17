import { PhysicalCamera } from '../core/PhysicalCamera.js';
export class PhysicalCameraUniform {

	constructor() {

		this.focalLength = 0;
		this.apertureBlades = 0;
		this.apertureRotation = 0;
		this.fStop = 0;
		this.focusDistance = 10;
		this.anamorphicRatio = 1;

	}

	updateFrom( camera ) {

		this.focalLength = camera.getFocalLength();
		if ( camera instanceof PhysicalCamera ) {

			this.apertureBlades = camera.apertureBlades;
			this.apertureRotation = camera.apertureRotation;
			this.fStop = camera.fStop;
			this.focusDistance = camera.focusDistance;
			this.anamorphicRatio = camera.anamorphicRatio;

		} else {

			this.apertureRotation = 0;
			this.apertureBlades = 0;
			this.fStop = 0;
			this.focusDistance = 10;
			this.anamorphicRatio = 1;

		}

	}

}
