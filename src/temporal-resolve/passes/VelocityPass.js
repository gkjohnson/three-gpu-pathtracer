import {
	HalfFloatType,
	NearestFilter,
	ShaderMaterial,
	UniformsUtils,
	WebGLRenderTarget
} from 'three';
import { VelocityShader } from '../materials/VelocityShader';

export class VelocityPass {

	constructor( scene, camera ) {

		this.scene = scene;
		this.camera = camera;

		this.cachedMaterials = new WeakMap();

		this.renderTarget = new WebGLRenderTarget(
			typeof window !== 'undefined' ? window.innerWidth : 2000,
			typeof window !== 'undefined' ? window.innerHeight : 1000,
			{
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				type: HalfFloatType,
			}
		);

	}

	setVelocityMaterialInScene() {

		this.scene.traverse( ( c ) => {

			if ( c.material ) {

				const originalMaterial = c.material;

				// eslint-disable-next-line prefer-const
				let [ cachedOriginalMaterial, velocityMaterial ] =
					this.cachedMaterials.get( c ) || [];

				if (
					! this.cachedMaterials.has( c ) ||
					originalMaterial !== cachedOriginalMaterial
				) {

					velocityMaterial = new ShaderMaterial( {
						uniforms: UniformsUtils.clone( VelocityShader.uniforms ),
						vertexShader: VelocityShader.vertexShader,
						fragmentShader: VelocityShader.fragmentShader,
					} );

					this.cachedMaterials.set( c, [ originalMaterial, velocityMaterial ] );

				}

				velocityMaterial.uniforms.velocityMatrix.value.multiplyMatrices(
					this.camera.projectionMatrix,
					c.modelViewMatrix
				);

				c.material = velocityMaterial;

			}

		} );

	}

	unsetVelocityMaterialInScene() {

		this.scene.traverse( ( c ) => {

			if ( c.material ) {

				c.material.uniforms.prevVelocityMatrix.value.copy(
					c.material.uniforms.velocityMatrix.value
				);

				const [ originalMaterial ] = this.cachedMaterials.get( c );

				c.material = originalMaterial;

			}

		} );

	}

	dispose() {

		this.renderTarget.dispose();

	}

	setSize( width, height ) {

		this.renderTarget.setSize( width, height );

	}

	render( renderer ) {

		this.setVelocityMaterialInScene();

		renderer.setRenderTarget( this.renderTarget );
		renderer.clear();
		renderer.render( this.scene, this.camera );

		this.unsetVelocityMaterialInScene();

	}

}
