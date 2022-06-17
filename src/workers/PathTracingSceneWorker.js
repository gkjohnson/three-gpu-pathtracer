import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';
import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';

export class PathTracingSceneWorker extends PathTracingSceneGenerator {

	constructor() {

		super();
		this.bvhGenerator = new GenerateMeshBVHWorker();

	}

	generate( scene, options = {} ) {

		const { bvhGenerator } = this;
		const { geometry, materials, textures, lights } = this.prepScene( scene );

		const bvhOptions = { strategy: SAH, ...options, maxLeafTris: 1 };
		const bvhPromise = bvhGenerator.generate( geometry, bvhOptions );
		return bvhPromise.then( bvh => {

			return {
				scene,
				materials,
				textures,
				lights,
				bvh,
			};

		} );

	}

	dispose() {

		this.bvhGenerator.dispose();

	}

}
