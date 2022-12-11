import { BufferGeometry } from 'three';
import { StaticGeometryGenerator, MeshBVH } from 'three-mesh-bvh';
import { setCommonAttributes, getGroupMaterialIndicesAttribute } from '../utils/GeometryPreparationUtils.js';

export class DynamicPathTracingSceneGenerator {

	get initialized() {

		return Boolean( this.bvh );

	}

	constructor( scene ) {

		this.objects = Array.isArray( scene ) ? scene : [ scene ];
		this.bvh = null;
		this.geometry = new BufferGeometry();
		this.materials = null;
		this.textures = null;
		this.lights = [];
		this.staticGeometryGenerator = new StaticGeometryGenerator( this.objects );

	}

	reset() {

		this.bvh = null;
		this.geometry.dispose();
		this.geometry = new BufferGeometry();
		this.materials = null;
		this.textures = null;
		this.lights = [];
		this.staticGeometryGenerator = new StaticGeometryGenerator( this.objects );

	}

	dispose() {}

	generate() {

		const { objects, staticGeometryGenerator, geometry } = this;
		if ( this.bvh === null ) {

			const attributes = [ 'position', 'normal', 'tangent', 'uv', 'color' ];

			for ( let i = 0, l = objects.length; i < l; i ++ ) {

				objects[ i ].traverse( c => {

					if ( c.isMesh ) {

						const normalMapRequired = ! ! c.material.normalMap;
						setCommonAttributes( c.geometry, { attributes, normalMapRequired } );

					} else if ( c.isRectAreaLight || c.isSpotLight ) {

						this.lights.push( c );

					}

				} );

			}

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
				lights: this.lights,
				bvh: this.bvh,
				materials: this.materials,
				textures: this.textures,
				objects,
			};

		} else {

			const { bvh } = this;
			staticGeometryGenerator.generate( geometry );
			bvh.refit();
			return {
				lights: this.lights,
				bvh: this.bvh,
				materials: this.materials,
				textures: this.textures,
				objects,
			};

		}

	}


}
