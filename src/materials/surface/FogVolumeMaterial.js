import { MeshStandardMaterial } from 'three';

export class FogVolumeMaterial extends MeshStandardMaterial {

	get density() {

		return this.opacity;

	}

	set density( v ) {

		this.opacity = v;

	}

	constructor( params ) {

		super( params );

		this.isFogVolumeMaterial = true;

	}

}
