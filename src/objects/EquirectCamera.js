import { Camera } from 'three';

export class EquirectCamera extends Camera {

	constructor() {

		super();

		this.isEquirectCamera = true;

	}

}
