import { PerspectiveCamera } from 'three';

export class PhysicalCamera extends PerspectiveCamera {

	set bokehSize( size ) {

		this.fStop = this.getFocalLength() / size;

	}

	get bokehSize() {

		return this.getFocalLength() / this.fStop;

	}

	constructor( ...args ) {

		super( ...args );
		this.fStop = 1.4;
		this.apertureBlades = 0;
		this.apertureRotation = 0;
		this.focusDistance = 25;
		this.anamorphicRatio = 1;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.fStop = source.fStop;
		this.apertureBlades = source.apertureBlades;
		this.apertureRotation = source.apertureRotation;
		this.focusDistance = source.focusDistance;
		this.anamorphicRatio = source.anamorphicRatio;

		return this;

	}

}
