import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';

export class PathTracingSceneGenerator {

	constructor() {

		this.bvhGenerator = new GenerateMeshBVHWorker();

	}

	async generate( scene, options = {} ) {

		const { bvhGenerator } = this;
		const meshes = [];

		scene.traverse( c => {

			if ( c.isMesh ) {

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
