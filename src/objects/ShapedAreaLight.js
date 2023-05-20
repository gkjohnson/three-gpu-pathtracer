import { RectAreaLight } from 'three';

export class ShapedAreaLight extends RectAreaLight {

	constructor( ...args ) {

		super( ...args );
		this.isCircular = false;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.isCircular = source.isCircular;

		return this;

	}

}
