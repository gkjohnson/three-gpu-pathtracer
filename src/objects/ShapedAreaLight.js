import { RectAreaLight } from 'three';

export class ShapedAreaLight extends RectAreaLight {

	constructor( ...args ) {

		super( ...args );
		this.isCircular = false;
		this.visibleSurface = false;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.isCircular = source.isCircular;
		this.visibleSurface = source.visibleSurface;

		return this;

	}

}
