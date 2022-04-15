import { Mesh } from 'three';
import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';
import { StaticGeometryGenerator } from 'three-mesh-bvh';

export class PathTracingSceneGenerator {

	constructor() {

		this.bvhGenerator = new GenerateMeshBVHWorker();

	}

	async generate( scene, options = {} ) {

		const { bvhGenerator } = this;
		const meshes = [];

		scene.traverse( c => {

			if ( c.isSkinnedMesh || c.isMesh && c.morphTargetInfluences ) {

				const generator = new StaticGeometryGenerator( c );
				const mesh = new Mesh(
					generator.generate(),
					c.materials,
				);
				mesh.matrixWorld.copy( c.matrixWorld );
				mesh.matrix.copy( c.matrixWorld );
				mesh.matrix.decompose( mesh.position, mesh.quaternion, mesh.scale );
				meshes.push( mesh );

			} else if ( c.isMesh ) {

				meshes.push( c );

			}

		} );

		const { geometry, materials, textures } = mergeMeshes( meshes, { attributes: [ 'position', 'normal', 'tangent', 'uv' ] } );
		const bvhPromise = bvhGenerator.generate( geometry, { strategy: SAH, ...options, maxLeafTris: 1 } );

		return {
			scene,
			materials,
			textures,
			bvh: await bvhPromise,
		};

	}

	dispose() {

		this.bvhGenerator.terminate();

	}

}
