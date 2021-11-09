import { MaterialStructUniform } from './MaterialStructUniform.js';

export class MaterialStructArrayUniform extends Array {

	updateFrom( arr ) {

		while ( this.length > arr.length ) this.pop();
		while ( this.length < arr.length ) this.push( new MaterialStructUniform() );

		for ( let i = 0, l = this.length; i < l; i ++ ) {

			this[ i ].updateFrom( arr[ i ] );

		}

	}

}
