import { WebGLRenderTarget, SRGBColorSpace, Mesh, MeshNormalMaterial } from 'three';
import { createAlbedoShaderMaterial } from '../../materials/denoiser/createAlbedoMaterial.js';

export class AlbedoNormalPass {

	constructor() {

		this.albedoRenderTarget = new WebGLRenderTarget( 1, 1, { samples: 4, colorSpace: SRGBColorSpace } );
		this.normalRenderTarget = new WebGLRenderTarget( 1, 1, { samples: 4, colorSpace: SRGBColorSpace } );
		this.albedoRenderTarget.texture.colorSpace = SRGBColorSpace;
		this.normalMaterial = new MeshNormalMaterial();

	}

	render( renderer, scene, camera, width, height ) {

		this.albedoRenderTarget.setSize( width, height );
		this.normalRenderTarget.setSize( width, height );

		const oldRenderTarget = renderer.getRenderTarget();

		// Normal pass
		this.swapMaterials( scene, 'normal' );
		renderer.setRenderTarget( this.normalRenderTarget );
		renderer.render( scene, camera );

		// Albedo pass
		this.swapMaterials( scene, 'albedo' );
		this.albedoRenderTarget.colorSpace = SRGBColorSpace;
		this.albedoRenderTarget.texture.colorSpace = SRGBColorSpace;
		renderer.setRenderTarget( this.albedoRenderTarget );
		renderer.render( scene, camera );

		// Restore original materials
		this.swapMaterials( scene );
		renderer.setRenderTarget( oldRenderTarget );

		// return the two textures
		return { albedo: this.albedoRenderTarget.texture, normal: this.normalRenderTarget.texture };

	}

	generateObjectMaterials( object ) {

		// original material
		object.userData.originalMaterial = object.material;

		// normal material
		// If the objects original material has a normal map, clone our material and apply the map
		if ( object.material.normalMap ) {

			const newNormalMaterial = this.normalMaterial.clone();
			newNormalMaterial.normalMap = object.material.normalMap;
			newNormalMaterial.normalScale.copy( object.material.normalScale );
			object.userData.normalMaterial = newNormalMaterial;

		} else object.userData.normalMaterial = this.normalMaterial;

		// albedo material
		object.userData.albedoMaterial = createAlbedoShaderMaterial( object.material );

	}

	swapMaterials( object, swapTo = 'original' ) {

		if ( object instanceof Mesh && object.material ) {

			if ( ! object.userData.originalMaterial ) this.generateObjectMaterials( object );
			switch ( swapTo ) {

			case 'albedo':
				object.material = object.userData.albedoMaterial;
				break;
			case 'normal':
				object.material = object.userData.normalMaterial;
				break;
			default:
				object.material = object.userData.originalMaterial;

			}

		}

		// biome-ignore lint/complexity/noForEach: <explanation>
		object.children.forEach( child => this.swapMaterials( child, swapTo ) );

	}

}
