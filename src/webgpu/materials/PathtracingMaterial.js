import { lambertBsdfFunc } from '../nodes/material.wgsl';

/**
 * Defines a material sampled by the pathtracer
 */
export class PathtracingMaterial {

	/**
	 *
	 * Called once per material
	 * Adds ability to initialize state
	 *
	 */
	init( /* renderer */ ) {

	}

	/**
	 *
	 * Must return a bsdf sampling function node with signature
	 * ( worldView: vec3f, surface: Surface ) -> ScatterRecord
	 *
	 */
	getBsdfNode() {

		return lambertBsdfFunc;

	}

	getData() {

		return {

			bsdfSample: this.getBsdfNode(),

		};

	}

}
