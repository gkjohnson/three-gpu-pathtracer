import { WebGLRenderTarget, SRGBColorSpace, Mesh, MeshNormalMaterial, MeshBasicMaterial, NoBlending } from 'three';

// Material pool
class MaterialPool {

	constructor() {

		this.normalMaterial = new MeshNormalMaterial();
		this.albedoMaterial = new MeshBasicMaterial();
		this.originalMaterials = new Map();

		this.normalMaterials = [];
		this.albedoMaterials = [];
		// materials in use
		this.normalsInUse = [];
		this.albedosInUse = [];

	}

	getMaterial( mesh, type = 'normal' ) {

		// check if the object exists in the originals map
		if ( ! this.originalMaterials.has( mesh ) ) this.setOriginal( mesh );
		const originalMaterial = this.originalMaterials.get( mesh );
		const material = this._getNextMaterial( type );

		material.map = originalMaterial.map;
		material.color = originalMaterial.color;
		if ( type === 'normal' ) material.normalMap = originalMaterial.normalMap;

		return material;

	}

	_getNextMaterial( type = 'normal' ) {

		// get the latest material from the pool and move it to the in use array
		let material = this[ `${type}Materials` ].pop();

		// if there are no materials left in the pool, create a new one
		if ( ! material ) material = this[ `${type}Material` ].clone();

		// add the material to the in use array
		this[ `${type}sInUse` ].push( material );

		return material;

	}

	setOriginal( mesh ) {

		this.originalMaterials.set( mesh, mesh.material );

	}

	restoreOriginal( mesh ) {

		// reset the state of the applied material
		if ( mesh.material.map ) mesh.material.map = null;
		if ( mesh.material.normalMap ) mesh.material.normalMap = null;
		if ( mesh.material.color ) mesh.material.color = 0xffffff;
		// restore the original material
		mesh.material = this.originalMaterials.get( mesh );
		// remove our reference to the original material
		this.originalMaterials.delete( mesh );

	}

	// move the materials back to the pool
	reset() {

		this.normalsInUse.forEach( material => this.normalMaterials.push( material ) );
		this.albedosInUse.forEach( material => this.albedoMaterials.push( material ) );

		this.normalsInUse.length = 0;
		this.albedosInUse.length = 0;

	}

	dispose() {

		this.normalMaterials.forEach( material => material.dispose() );
		this.albedoMaterials.forEach( material => material.dispose() );
		this.originalMaterials.clear();
		this.normalsInUse.length = 0;
		this.albedosInUse.length = 0;
		this.normalMaterials.length = 0;
		this.albedoMaterials.length = 0;

	}

}


export class AlbedoNormalPass {

	constructor() {

		this.albedoRenderTarget = new WebGLRenderTarget( 1, 1, { samples: 4, colorSpace: SRGBColorSpace } );
		this.normalRenderTarget = new WebGLRenderTarget( 1, 1, { samples: 4, colorSpace: SRGBColorSpace } );
		this.albedoRenderTarget.texture.colorSpace = SRGBColorSpace;
		this.materialPool = new MaterialPool();

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
		renderer.setRenderTarget( this.albedoRenderTarget );
		renderer.render( scene, camera );

		// Restore original materials
		this.swapMaterials( scene );

		// return the renderer to the original render target
		renderer.setRenderTarget( oldRenderTarget );
		this.materialPool.reset();

		// return the two textures
		return { albedo: this.albedoRenderTarget.texture, normal: this.normalRenderTarget.texture };

	}

	swapMaterials( object, swapTo = '' ) {

		if ( object instanceof Mesh && object.material ) {

			if ( swapTo ) object.material = this.materialPool.getMaterial( object, swapTo );
			else this.materialPool.restoreOriginal( object );

		}

		object.children.forEach( child => this.swapMaterials( child, swapTo ) );

	}

	// cleanup
	dispose() {

		this.materialPool.dispose();

	}

}
