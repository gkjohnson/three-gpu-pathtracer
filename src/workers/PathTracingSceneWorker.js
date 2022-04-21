import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';

export class PathTracingSceneWorker extends PathTracingSceneGenerator {

	constructor() {

		this.bvhGenerator = new GenerateMeshBVHWorker();

	}
	
	generate( scene, options = {} ) {

		const { bvhGenerator } = this;
		const { geometry, materials, textures } = this.prepScene( scene );

		const bvhOptions = { strategy: SAH, ...options, maxLeafTris: 1 };
		const bvhPromise = bvhGenerator.generate( geometry, bvhOptions );
		return bvhPromise.then( bvh => {

			return {
				scene,
				materials,
				textures,
				bvh,
			};

		} );

	}

}
