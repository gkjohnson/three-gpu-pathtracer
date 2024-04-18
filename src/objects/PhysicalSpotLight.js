import { SpotLight } from 'three';

export class PhysicalSpotLight extends SpotLight {

	constructor( ...args ) {

		super( ...args );

		this.iesMap = null;
		this.radius = 0;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.iesMap = source.iesMap;
		this.radius = source.radius;

		return this;

	}

}
