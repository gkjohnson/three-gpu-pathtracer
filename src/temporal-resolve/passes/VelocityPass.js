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
import { VelocityShader } from '../materials/VelocityShader.js';

const backgroundColor = new Color( 0 );
const updateProperties = [ 'visible', 'wireframe', 'side' ];

function disposeVelocityMaterial( material ) {

	const boneTexture = material.uniforms.prevBoneTexture.value;
	if ( boneTexture ) boneTexture.dispose();
	material.dispose();

}

export class VelocityPass {

	constructor( scene, camera ) {

		this.scene = scene;
		this.camera = camera;

		this.cachedMaterials = new WeakMap();
		this.materialReplacements = new Map();
		this.velocityMaterials = new Set();

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

		const replacements = this.materialReplacements = new Map();
		this.scene.traverse( c => {

			if ( c.material && ! replacements.has( c ) ) {

				const originalMaterial = c.material;

				// eslint-disable-next-line prefer-const
				let [ cachedOriginalMaterial, velocityMaterial ] = this.cachedMaterials.get( c ) || [];
				// Record before any swap so partial setup can restore this exact object.
				const replacement = { originalMaterial, velocityMaterial };
				replacements.set( c, replacement );

				if ( originalMaterial !== cachedOriginalMaterial ) {

					const previousVelocityMaterial = velocityMaterial;
					velocityMaterial = new ShaderMaterial( {
						uniforms: UniformsUtils.clone( VelocityShader.uniforms ),
						vertexShader: VelocityShader.vertexShader,
						fragmentShader: VelocityShader.fragmentShader
					} );
					replacement.velocityMaterial = velocityMaterial;
					this.velocityMaterials.add( velocityMaterial );

					if ( previousVelocityMaterial ) {

						disposeVelocityMaterial( previousVelocityMaterial );
						this.velocityMaterials.delete( previousVelocityMaterial );

					}

					c.material = velocityMaterial;

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

	saveBoneTexture( object, material = object.material ) {

		let boneTexture = material.uniforms.prevBoneTexture.value;

		if ( boneTexture && boneTexture.image.width === object.skeleton.boneTexture.width ) {

			boneTexture = material.uniforms.prevBoneTexture.value;
			boneTexture.image.data.set( object.skeleton.boneTexture.image.data );

		} else {

			if ( boneTexture ) boneTexture.dispose();

			const boneMatrices = object.skeleton.boneTexture.image.data.slice();
			const size = object.skeleton.boneTexture.image.width;

			boneTexture = new DataTexture( boneMatrices, size, size, RGBAFormat, FloatType );
			material.uniforms.prevBoneTexture.value = boneTexture;

			boneTexture.needsUpdate = true;

		}

	}

	unsetVelocityMaterialInScene( updateHistory = true ) {

		const replacements = this.materialReplacements;
		try {

			if ( updateHistory ) {

				for ( const [ object, { velocityMaterial } ] of replacements ) {

					velocityMaterial.uniforms.prevVelocityMatrix.value.multiplyMatrices( this.camera.projectionMatrix, object.modelViewMatrix );
					if ( object.skeleton && object.skeleton.boneTexture ) this.saveBoneTexture( object, velocityMaterial );

				}

			}

		} finally {

			for ( const [ object, { originalMaterial } ] of replacements ) {

				object.material = originalMaterial;

			}
			replacements.clear();

		}

	}

	dispose() {

		this.renderTarget.dispose();
		for ( const material of this.velocityMaterials ) {

			disposeVelocityMaterial( material );

		}
		this.velocityMaterials.clear();
		this.cachedMaterials = new WeakMap();

	}

	setSize( width, height ) {

		this.renderTarget.setSize( width, height );

	}

	render( renderer ) {

		const { background, overrideMaterial } = this.scene;
		let rendered = false;
		try {

			this.setVelocityMaterialInScene();

			renderer.setRenderTarget( this.renderTarget );
			renderer.clear();
			this.scene.background = backgroundColor;
			this.scene.overrideMaterial = null;

			renderer.render( this.scene, this.camera );
			rendered = true;

		} finally {

			this.scene.background = background;
			this.scene.overrideMaterial = overrideMaterial;
			this.unsetVelocityMaterialInScene( rendered );

		}

	}

}
