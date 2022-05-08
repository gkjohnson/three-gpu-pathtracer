import { BufferGeometry } from 'three';
import { StaticGeometryGenerator, MeshBVH } from 'three-mesh-bvh';
import { setCommonAttributes, getGroupMaterialIndicesAttribute } from '../utils/GeometryPreparationUtils.js';

export class DynamicPathTracingSceneGenerator {

	get initialized() {

		return Boolean( this.bvh );

	}

	constructor( scene ) {

		this.scene = scene;
		this.bvh = null;
		this.geometry = new BufferGeometry();
		this.materials = null;
		this.textures = null;
		this.staticGeometryGenerator = new StaticGeometryGenerator( scene );

	}

	reset() {

		this.bvh = null;
		this.geometry.dispose();
		this.geometry = new BufferGeometry();
		this.materials = null;
		this.textures = null;
		this.staticGeometryGenerator = new StaticGeometryGenerator( this.scene );

	}

	dispose() {}

	generate() {

		const { scene, staticGeometryGenerator, geometry } = this;
		if ( this.bvh === null ) {

			const attributes = [ 'position', 'normal', 'tangent', 'uv' ];
			scene.traverse( c => {

				if ( c.isMesh ) {

					const normalMapRequired = ! ! c.material.normalMap;
					setCommonAttributes( c.geometry, { attributes, normalMapRequired } );

				}

			} );

			const textureSet = new Set();
			const materials = staticGeometryGenerator.getMaterials();
			materials.forEach( material => {

				for ( const key in material ) {

					const value = material[ key ];
					if ( value && value.isTexture ) {

						textureSet.add( value );

					}

				}

			} );

			staticGeometryGenerator.attributes = attributes;
			staticGeometryGenerator.generate( geometry );

			const materialIndexAttribute = getGroupMaterialIndicesAttribute( geometry, materials, materials );
			geometry.setAttribute( 'materialIndex', materialIndexAttribute );
			geometry.clearGroups();

			this.bvh = new MeshBVH( geometry );
			this.materials = materials;
			this.textures = Array.from( textureSet );

			return {
				bvh: this.bvh,
				materials: this.materials,
				textures: this.textures,
				scene,
			};

		} else {

			const { bvh } = this;
			staticGeometryGenerator.generate( geometry );
			bvh.refit();
			return {
				bvh: this.bvh,
				materials: this.materials,
				textures: this.textures,
				scene,
			};

		}

	}


}
