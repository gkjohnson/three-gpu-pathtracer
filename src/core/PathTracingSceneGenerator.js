import { DynamicPathTracingSceneGenerator } from './DynamicPathTracingSceneGenerator.js';

export class PathTracingSceneGenerator {

	generate( scene, options = {} ) {

		// ensure scene transforms are up to date
		// TODO: remove this?
		if ( Array.isArray( scene ) ) {

			scene.forEach( s => s.updateMatrixWorld( true ) );

		} else {

			scene.updateMatrixWorld( true );

		}

		const generator = new DynamicPathTracingSceneGenerator( scene );
		generator.bvhOptions = options;
		return generator.generate();

	}

}
