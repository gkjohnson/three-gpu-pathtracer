import { SpotLight } from 'three';

// TODO: this should extend IESSpotLight, but the class is only exported from "three/webgpu" and
// the node library resolves light nodes by exact constructor so a subclass would not rasterize
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
