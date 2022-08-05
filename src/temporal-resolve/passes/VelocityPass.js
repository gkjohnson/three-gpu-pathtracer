import {
	Color,
	DataTexture,
	FloatType,
	HalfFloatType,
	LinearFilter,
	RGBAFormat,
	ShaderMaterial,
	UniformsUtils,
	WebGLRenderTarget
} from 'three';
import { VelocityShader } from '../materials/VelocityShader';

const backgroundColor = new Color( 0 );
const updateProperties = [ 'visible', 'wireframe', 'side' ];

export class VelocityPass {

	constructor( scene, camera ) {

		this.scene = scene;
		this.camera = camera;

		this.cachedMaterials = new WeakMap();

		this.renderTarget = new WebGLRenderTarget(
			typeof window !== 'undefined' ? window.innerWidth : 2000,
			typeof window !== 'undefined' ? window.innerHeight : 1000,
			{
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				type: HalfFloatType,
			}
		);

	}

	setVelocityMaterialInScene() {

		this.scene.traverse( c => {

			if ( c.material ) {

				const originalMaterial = c.material;

				// eslint-disable-next-line prefer-const
				let [ cachedOriginalMaterial, velocityMaterial ] = this.cachedMaterials.get( c ) || [];

				if ( originalMaterial !== cachedOriginalMaterial ) {

					velocityMaterial = new ShaderMaterial( {
						uniforms: UniformsUtils.clone( VelocityShader.uniforms ),
						vertexShader: VelocityShader.vertexShader,
						fragmentShader: VelocityShader.fragmentShader
					} );

					if ( c.skeleton && c.skeleton.boneTexture ) this.saveBoneTexture( c );

					this.cachedMaterials.set( c, [ originalMaterial, velocityMaterial ] );

				}

				velocityMaterial.uniforms.velocityMatrix.value.multiplyMatrices(
					this.camera.projectionMatrix,
					c.modelViewMatrix
				);

				for ( const prop of updateProperties ) velocityMaterial[ prop ] = originalMaterial[ prop ];

				if ( c.skeleton ) {

					velocityMaterial.defines.USE_SKINNING = '';
					velocityMaterial.defines.BONE_TEXTURE = '';

					velocityMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture;

				}

				c.material = velocityMaterial;

			}

		} );

	}

	saveBoneTexture( object ) {

		let boneTexture = object.material.uniforms.prevBoneTexture.value;

		if ( boneTexture && boneTexture.image.width === object.skeleton.boneTexture.width ) {

			boneTexture = object.material.uniforms.prevBoneTexture.value;
			boneTexture.image.data.set( object.skeleton.boneTexture.image.data );

		} else {

			if ( boneTexture ) boneTexture.dispose();

			const boneMatrices = object.skeleton.boneTexture.image.data.slice();
			const size = object.skeleton.boneTexture.image.width;

			boneTexture = new DataTexture( boneMatrices, size, size, RGBAFormat, FloatType );
			object.material.uniforms.prevBoneTexture.value = boneTexture;

			boneTexture.needsUpdate = true;

		}

	}

	unsetVelocityMaterialInScene() {

		this.scene.traverse( c => {

			if ( c.material ) {

				c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices( this.camera.projectionMatrix, c.modelViewMatrix );

				if ( c.skeleton && c.skeleton.boneTexture ) this.saveBoneTexture( c );

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
		const { background } = this.scene;
		this.scene.background = backgroundColor;

		renderer.render( this.scene, this.camera );

		this.scene.background = background;

		this.unsetVelocityMaterialInScene();

	}

}
