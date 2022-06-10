import { Mesh } from 'three';
import { SAH, MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';

export class PathTracingSceneGenerator {

	prepScene( scene ) {

		const meshes = [];
		const lights = [];
		scene.traverse( c => {

			if ( c.isSkinnedMesh || c.isMesh && c.morphTargetInfluences ) {

				const generator = new StaticGeometryGenerator( c );
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

			} else if ( c.isRectAreaLight ) {

				lights.push( c );

			}

		} );

		return {
			...mergeMeshes( meshes, {
				attributes: [ 'position', 'normal', 'tangent', 'uv' ],
			} ),
			lights
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
