import { Mesh } from 'three';
import { DynamicPathTracingSceneGenerator } from './DynamicPathTracingSceneGenerator.js';

export class PathTracingSceneGenerator {

	generate( scene, options = {} ) {

		// handle negative scales
		const objects = [];
		const scenes = Array.isArray( scene ) ? scene : [ scene ];
		scenes.forEach( s => {

			s.traverseVisible( c => {

				if ( c.isMesh ) {

					const o = new Mesh( c.geometry, c.material );
					o.matrixWorld.copy( c.matrixWorld );
					objects.push( o );

					if ( c.matrixWorld.determinant() < 0 ) {

						o.geometry = o.geometry.clone();
						o.geometry.index.array.reverse();

					}

				}

			} );

		} );

		const generator = new DynamicPathTracingSceneGenerator( objects );
		generator.bvhOptions = options;
		return generator.generate();

	}

}
