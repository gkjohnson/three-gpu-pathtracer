import { DynamicPathTracingSceneGenerator } from './DynamicPathTracingSceneGenerator.js';

export class PathTracingSceneGenerator {

	generate( scene, options = {} ) {

		const generator = new DynamicPathTracingSceneGenerator( scene );
		generator.bvhOptions = options;
		return generator.generate();

	}

}
