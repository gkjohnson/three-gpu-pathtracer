import { Camera } from 'three';

export class EquirectCamera extends Camera {

	constructor() {

		super();

		this.isEquirectCamera = true;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.isEquirectCamera = source.isEquirectCamera;

		return this;

	}

}
