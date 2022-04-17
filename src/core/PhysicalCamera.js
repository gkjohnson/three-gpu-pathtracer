import { PerspectiveCamera } from 'three';

export class PhysicalCamera extends PerspectiveCamera {

	constructor( ...args ) {

		super( ...args );
		this.fStop = 0;
		this.apertureBlades = 0;
		this.focusDistance = 10;
		this.anamorphicRatio = 1;

	}

}
