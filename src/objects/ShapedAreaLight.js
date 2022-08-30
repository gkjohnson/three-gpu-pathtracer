import { RectAreaLight } from 'three';

export class ShapedAreaLight extends RectAreaLight {

	constructor( ...args ) {

		super( ...args );
		this.isCircular = false;

	}

}
