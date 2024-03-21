import { BufferGeometry, MeshBasicMaterial, BufferAttribute, Mesh } from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { StaticGeometryGenerator } from './utils/StaticGeometryGenerator.js';
import { updateMaterialIndexAttribute } from './utils/GeometryPreparationUtils.js';

// collect the textures from the materials
function getTextures( materials ) {

	const textureSet = new Set();
	for ( let i = 0, l = materials.length; i < l; i ++ ) {

		const material = materials[ i ];
		for ( const key in material ) {

			const value = material[ key ];
			if ( value && value.isTexture ) {

				textureSet.add( value );

			}

		}

	}

	return Array.from( textureSet );

}

// collect the lights in the scene
function getLights( objects ) {

	const lights = [];
	for ( let i = 0, l = objects.length; i < l; i ++ ) {

		objects[ i ].traverse( c => {

			if (
				c.isRectAreaLight ||
				c.isSpotLight ||
				c.isPointLight ||
				c.isDirectionalLight
			) {

				lights.push( c );

			}

		} );

	}

	return lights;

}

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
		this.generateBVH = true;

		// state
		this.objects = finalObjects;
		this.bvh = null;
		this.geometry = new BufferGeometry();
		this.staticGeometryGenerator = new StaticGeometryGenerator( this.objects );

	}

	reset() {

		this.bvh = null;
		this.geometry.dispose();
		this.geometry = new BufferGeometry();
		this.staticGeometryGenerator = new StaticGeometryGenerator( this.objects );

	}

	dispose() {}

	generate() {

		const { objects, staticGeometryGenerator, geometry, attributes } = this;
		staticGeometryGenerator.attributes = attributes;

		// update the skeleton animations in case WebGLRenderer is not running
		// to update it.
		objects.forEach( o => {

			o.traverse( c => {

				if ( c.isSkinnedMesh && c.skeleton ) {

					c.skeleton.update();

				}

			} );

		} );

		// generate the geometry
		const result = staticGeometryGenerator.generate( geometry );
		const materials = result.materials;
		const textures = getTextures( materials );
		const lights = getLights( objects );

		updateMaterialIndexAttribute( geometry, materials, materials );
		geometry.clearGroups();

		// only generate a new bvh if the objects used have changed
		if ( this.generateBVH ) {

			if ( result.objectsChanged ) {

				this.bvh = new MeshBVH( geometry, { strategy: SAH, maxLeafTris: 1, indirect: true, ...this.bvhOptions } );

			} else {

				this.bvh.refit();

			}

		}

		return {
			bvh: this.bvh,
			objectsChanged: result.objectsChanged,
			lights,
			geometry,
			materials,
			textures,
			objects,
		};

	}


}
