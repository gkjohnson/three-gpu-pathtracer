import { SpotLight } from 'three';

export class PhysicalSpotLight extends SpotLight {

	constructor( ...args ) {

		super( ...args );

		this.iesTexture = null;
		this.radius = 0;

	}

}
