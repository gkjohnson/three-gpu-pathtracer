import { Color, MeshStandardMaterial } from 'three';

export class FogVolumeMaterial extends MeshStandardMaterial {

	constructor( params ) {

		super( params );

		this.isFogVolumeMaterial = true;

		this.density = 0.015;
		this.emissive = new Color();
		this.emissiveIntensity = 0.0;
		this.opacity = 0.15;
		this.transparent = true;
		this.roughness = 1.0;
		this.metalness = 0.0;

		this.setValues( params );

	}

}
