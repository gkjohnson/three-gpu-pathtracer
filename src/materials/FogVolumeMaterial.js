import { Color, MeshBasicMaterial } from 'three';

export class FogVolumeMaterial extends MeshBasicMaterial {

	constructor( params ) {

		super( params );

		this.isFogVolumeMaterial = true;

		this.density = 0.015;
		this.emissive = new Color();
		this.emissiveIntensity = 0.0;
		this.opacity = 0.15;
		this.transparent = true;

	}

}
