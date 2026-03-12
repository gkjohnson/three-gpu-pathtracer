import { lambertBsdfFunc } from '../nodes/material.wgsl';

/**
 * Defines a material sampled by the pathtracer
 */
export class PathtracingMaterial {

	/**
	 * Must return a bsdf sampling function node with signature
	 * ( worldView: vec3f, surface: Surface ) -> ScatterRecord
	 */
	getBsdfNode() {

		return lambertBsdfFunc;

	}

}
