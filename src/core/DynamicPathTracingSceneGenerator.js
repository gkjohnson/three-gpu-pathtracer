import { BufferGeometry, MeshBasicMaterial, BufferAttribute, Mesh } from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { StaticGeometryGenerator } from './utils/StaticGeometryGenerator.js';
import { setCommonAttributes, getGroupMaterialIndicesAttribute } from '../utils/GeometryPreparationUtils.js';

const dummyMaterial = new MeshBasicMaterial();
export function getDummyMesh() {

	const emptyGeometry = new BufferGeometry();
	emptyGeometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 9 ), 3 ) );
	return new Mesh( emptyGeometry, dummyMaterial );

}

export class DynamicPathTracingSceneGenerator {

	get initialized() {

		return Boolean( this.bvh );

	}

	constructor( objects ) {

		// ensure the objects is an array
		if ( ! Array.isArray( objects ) ) {

			objects = [ objects ];

		}

		// use a dummy object for a fallback
		const finalObjects = [ ...objects ];
		if ( finalObjects.length === 0 ) {

			finalObjects.push( getDummyMesh() );

		}

		// options
		this.bvhOptions = {};
		this.attributes = [ 'position', 'normal', 'tangent', 'color', 'uv', 'uv2' ];

		// state
		this.objects = finalObjects;
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

	prepScene() {

		if ( this.bvh !== null ) {

			return;

		}

		const { objects, staticGeometryGenerator, geometry, lights, attributes } = this;
		for ( let i = 0, l = objects.length; i < l; i ++ ) {

			objects[ i ].traverse( c => {

				if ( c.isMesh ) {

					setCommonAttributes( c.geometry, attributes );

				} else if (
					c.isRectAreaLight ||
					c.isSpotLight ||
					c.isPointLight ||
					c.isDirectionalLight
				) {

					lights.push( c );

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

		// TODO: this needs to modify the material index if possible
		const materialIndexAttribute = getGroupMaterialIndicesAttribute( geometry, materials, materials );
		geometry.setAttribute( 'materialIndex', materialIndexAttribute );
		geometry.clearGroups();

		this.materials = materials;
		this.textures = Array.from( textureSet );

	}

	generate() {

		const { objects, geometry } = this;

		// update the skeleton animations in case WebGLRenderer is not running
		// to update it.
		objects.forEach( o => {

			o.traverse( c => {

				if ( c.isSkinnedMesh && c.skeleton ) {

					c.skeleton.update();

				}

			} );

		} );

		if ( this.bvh === null ) {

			this.prepScene();
			this.bvh = new MeshBVH( geometry, { strategy: SAH, maxLeafTris: 1, ...this.bvhOptions } );


		} else {

			this.staticGeometryGenerator.generate( geometry );
			this.bvh.refit();

		}

		return {
			lights: this.lights,
			bvh: this.bvh,
			geometry: this.geometry,
			materials: this.materials,
			textures: this.textures,
			objects,
		};

	}


}
