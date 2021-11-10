import { MaterialStructUniform } from './MaterialStructUniform.js';

export class MaterialStructArrayUniform extends Array {

	updateFrom( materials, textures ) {

		while ( this.length > materials.length ) this.pop();
		while ( this.length < materials.length ) this.push( new MaterialStructUniform() );

		for ( let i = 0, l = this.length; i < l; i ++ ) {

			this[ i ].updateFrom( materials[ i ], textures );

		}

	}

}
