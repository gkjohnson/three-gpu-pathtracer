import { Color } from 'three';
export class MaterialStructUniform {

	constructor() {

		this.color = new Color( 0xffffff );
		this.map = null;

		this.metalness = 1.0;
		this.metalnessMap = null;

		this.roughness = 1.0;
		this.roughnessMap = null;

		this.ior = 1.0;
		this.transmission = 0.0;
		this.transmissionMap = null;

		this.emissive = new Color( 0 );
		this.emissiveIntensity = 1.0;
		this.emissiveMap = null;

		this.normalMap = null;

		// TODO: Clearcoat

		// TODO: Sheen


	}

	updateFrom( material ) {

		// color
		if ( 'color' in material ) this.color.copy( material.color );
		else material.color.set( 0xffffff );

		this.map = material.map || null;

		// metalness
		if ( 'metalness' in material ) this.metalness = material.metalness;
		else this.metalness = 1.0;

		this.metalnessMap = material.metalnessMap || null;

		// roughness
		if ( 'roughness' in material ) this.roughness = material.roughness;
		else this.roughness = 1.0;

		this.roughnessMap = material.roughnessMap || null;

		// transmission
		if ( 'ior' in material ) this.ior = material.ior;
		else this.ior = 1.0;

		if ( 'transmission' in material ) this.transmission = materia.transmission;
		else this.transmission = 0.0;

		this.transmissionMap = material.transmissionMap || null;

		// emission
		if ( 'emissive' in material ) this.emissive.copy( material.emissive );
		else this.emissive.set( 0 );

		if ( 'emissiveIntensity' in material ) this.emissiveIntensity = material.emissiveIntensity;
		else this.emissiveIntensity = 1.0;

		this.emissiveMap = material.emissiveMap || null;

		// normals
		this.normalMap = material.normalMap || null;

	}

}
