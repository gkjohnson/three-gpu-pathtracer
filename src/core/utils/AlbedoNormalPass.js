import { WebGLRenderTarget, SRGBColorSpace, Mesh, MeshNormalMaterial, MeshBasicMaterial, Color, } from 'three';

const _blackColor = /* @__PURE__ */ new Color( 0, 0, 0 );

// A normal material that supports texture partial transparency
class AlphaMapNormalMaterial extends MeshNormalMaterial {

	get map() {

		return this._uniforms.map.value;

	}

	set map( v ) {

		this._uniforms.map.value = v;

	}

	get alphaMap() {

		return this._uniforms.alphaMap.value;

	}

	set alphaMap( v ) {

		this._uniforms.alphaMap.value = v;

	}

	constructor( ...args ) {

		super( ...args );
		this._uniforms = {
			map: { value: null },
			alphaMap: { value: null },
		};

	}

	onBeforeCompile( shader ) {

		shader.uniforms = {
			...shader.uniforms,
			...this._uniforms,
		};

		shader.fragmentShader = shader.fragmentShader
			.replace( /#include <uv_pars_fragment>/, /* glsl */`

				#include <uv_pars_fragment>
				#include <map_pars_fragment>
				#include <alphamap_pars_fragment>
				#include <alphatest_pars_fragment>

			` )
			.replace( /#include <clipping_planes_fragment>/, /* glsl */`

				#include <map_fragment>
				#include <color_fragment>
				#include <alphamap_fragment>
				#include <alphatest_fragment>

				#include <clipping_planes_fragment>

			` );

	}

}

// Material pool
class MaterialPool {

	constructor() {

		this.normalMaterial = new AlphaMapNormalMaterial();
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
		material.opacity = originalMaterial.opacity;
		material.transparent = originalMaterial.transparent;
		material.depthWrite = originalMaterial.depthWrite;
		material.alphaTest = originalMaterial.alphaTest;
		material.alphaMap = originalMaterial.alphaMap;
		if ( material.color ) material.color.copy( originalMaterial.color );
		if ( type === 'normal' ) material.normalMap = originalMaterial.normalMap;
		else material.normalMap = null;

		material.needsUpdate = true;

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
		if ( mesh.material.alphaMap ) mesh.material.alphaMap = null;
		if ( mesh.material.normalMap ) mesh.material.normalMap = null;

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
		const prevBackground = scene.background;
		scene.background = _blackColor;

		this.swapMaterials( scene, 'normal' );
		renderer.setRenderTarget( this.normalRenderTarget );
		renderer.render( scene, camera );

		scene.background = prevBackground;

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

		object.traverse( child => {

			if ( child instanceof Mesh && child.material ) {

				if ( swapTo ) child.material = this.materialPool.getMaterial( child, swapTo );
				else this.materialPool.restoreOriginal( child );

			}

		} );

	}

	// cleanup
	dispose() {

		this.materialPool.dispose();

	}

}
