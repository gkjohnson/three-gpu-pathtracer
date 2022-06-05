import { Camera } from 'three';

export class SphericalCamera extends Camera {

	constructor() {

		super();

		this.isSphericalCamera = true;

	}

}
