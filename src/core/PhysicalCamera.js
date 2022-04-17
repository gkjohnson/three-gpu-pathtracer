import { PerspectiveCamera } from 'three';

export class PhysicalCamera extends PerspectiveCamera {

	constructor( ...args ) {

		super( ...args );
		this.fStop = 0;
		this.apertureBlades = 0;
		this.apertureRotation = 0;
		this.focusDistance = 25;
		this.anamorphicRatio = 1;

	}

}
