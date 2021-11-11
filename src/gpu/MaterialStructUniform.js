import { Color } from 'three';
export class MaterialStructUniform {

	constructor() {

		this.color = new Color( 0xffffff );
		this.map = - 1;

		this.metalness = 1.0;
		this.metalnessMap = - 1;

		this.roughness = 1.0;
		this.roughnessMap = - 1;

		this.ior = 1.0;
		this.transmission = 0.0;
		this.transmissionMap = - 1;

		this.emissive = new Color( 0 );
		this.emissiveIntensity = 1.0;
		this.emissiveMap = - 1;

		this.normalMap = - 1;

		// TODO: Clearcoat

		// TODO: Sheen


	}

	updateFrom( material, textures = [] ) {

		// color
		if ( 'color' in material ) this.color.copy( material.color );
		else material.color.set( 0xffffff );

		this.map = textures.indexOf( material.map );

		// metalness
		if ( 'metalness' in material ) this.metalness = material.metalness;
		else this.metalness = 1.0;

		this.metalnessMap = textures.indexOf( material.metalnessMap );

		// roughness
		if ( 'roughness' in material ) this.roughness = material.roughness;
		else this.roughness = 1.0;

		this.roughnessMap = textures.indexOf( material.roughnessMap );

		// transmission
		if ( 'ior' in material ) this.ior = material.ior;
		else this.ior = 1.0;

		if ( 'transmission' in material ) this.transmission = material.transmission;
		else this.transmission = 0.0;

		this.transmissionMap = textures.indexOf( material.transmissionMap );

		// emission
		if ( 'emissive' in material ) this.emissive.copy( material.emissive );
		else this.emissive.set( 0 );

		if ( 'emissiveIntensity' in material ) this.emissiveIntensity = material.emissiveIntensity;
		else this.emissiveIntensity = 1.0;

		this.emissiveMap = textures.indexOf( material.emissiveMap );

		// normals
		this.normalMap = textures.indexOf( material.normalMap );

	}

}
