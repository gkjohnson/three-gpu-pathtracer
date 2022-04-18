import { PhysicalCamera } from '../core/PhysicalCamera.js';
export class PhysicalCameraUniform {

	constructor() {

		this.bokehSize = 0;
		this.apertureBlades = 0;
		this.apertureRotation = 0;
		this.focusDistance = 10;
		this.anamorphicRatio = 1;

	}

	updateFrom( camera ) {

		if ( camera instanceof PhysicalCamera ) {

			this.bokehSize = camera.bokehSize;
			this.apertureBlades = camera.apertureBlades;
			this.apertureRotation = camera.apertureRotation;
			this.focusDistance = camera.focusDistance;
			this.anamorphicRatio = camera.anamorphicRatio;

		} else {

			this.bokehSize = 0;
			this.apertureRotation = 0;
			this.apertureBlades = 0;
			this.focusDistance = 10;
			this.anamorphicRatio = 1;

		}

	}

}
