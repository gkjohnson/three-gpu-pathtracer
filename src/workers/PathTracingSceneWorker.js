import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { DynamicPathTracingSceneGenerator } from '../core/DynamicPathTracingSceneGenerator.js';

export class PathTracingSceneWorker {

	constructor() {

		this.bvhGenerator = new GenerateMeshBVHWorker();

	}

	generate( scene, options = {} ) {

		// ensure scene transforms are up to date
		// TODO: remove this?
		if ( Array.isArray( scene ) ) {

			scene.forEach( s => s.updateMatrixWorld( true ) );

		} else {

			scene.updateMatrixWorld( true );

		}

		const { bvhGenerator } = this;
		const sceneGenerator = new DynamicPathTracingSceneGenerator( scene );
		sceneGenerator.prepScene();

		const { geometry, materials, textures, lights } = sceneGenerator;
		const bvhPromise = bvhGenerator.generate( geometry, options );
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
