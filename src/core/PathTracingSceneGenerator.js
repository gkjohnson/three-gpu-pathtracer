import { Mesh } from 'three';
import { SAH, MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';

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

				} else if ( c.isRectAreaLight || c.isSpotLight ) {

					lights.push( c );

				}

			} );

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
