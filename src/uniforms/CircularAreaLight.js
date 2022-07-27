import { RectAreaLight } from 'three';

export class CircularAreaLight extends RectAreaLight {

	constructor( ...args ) {

		super( ...args );
		this.isCircularAreaLight = true;

	}

}
