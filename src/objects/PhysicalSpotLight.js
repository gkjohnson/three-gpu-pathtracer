import { SpotLight } from 'three';

export class PhysicalSpotLight extends SpotLight {

	constructor( ...args ) {

		super( ...args );

		this.iesTexture = null;
		this.radius = 0;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.iesTexture = source.iesTexture;
		this.radius = source.radius;

		return this;

	}

}
