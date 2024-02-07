import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { SAH, MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';

const dummyMaterial = new MeshBasicMaterial();
export function getDummyMesh() {

	const emptyGeometry = new BufferGeometry();
	emptyGeometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 9 ), 3 ) );
	return new Mesh( emptyGeometry, dummyMaterial );

}

export class PathTracingSceneGenerator {

	prepScene( scene ) {

		scene = Array.isArray( scene ) ? scene : [ scene ];

		const meshes = [];
		const lights = [];

		for ( let i = 0, l = scene.length; i < l; i ++ ) {

			scene[ i ].traverseVisible( c => {

				if ( c.isSkinnedMesh || c.isMesh && c.morphTargetInfluences ) {

					const generator = new StaticGeometryGenerator( c );
					generator.attributes = [ 'position', 'color', 'normal', 'tangent', 'uv', 'uv2' ];
					generator.applyWorldTransforms = false;
					const mesh = new Mesh(
						generator.generate(),
						c.material,
					);
					mesh.matrixWorld.copy( c.matrixWorld );
					mesh.matrix.copy( c.matrixWorld );
					mesh.matrix.decompose( mesh.position, mesh.quaternion, mesh.scale );
					meshes.push( mesh );

				} else if ( c.isMesh ) {

					meshes.push( c );

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

		if ( meshes.length === 0 ) {

			meshes.push( getDummyMesh() );

		}

		return {
			...mergeMeshes( meshes, {
				attributes: [ 'position', 'normal', 'tangent', 'uv', 'color' ],
			} ),
			lights,
		};

	}

	generate( scene, options = {} ) {

		const { materials, textures, geometry, lights } = this.prepScene( scene );
		const bvhOptions = { strategy: SAH, ...options, maxLeafTris: 1 };
		return {
			scene,
			materials,
			textures,
			lights,
			bvh: new MeshBVH( geometry, bvhOptions ),
		};

	}

}
