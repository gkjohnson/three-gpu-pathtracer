import { lambertBsdfFunc } from '../nodes/material.wgsl.js';
import { proxyFn } from '../lib/nodes/NodeProxy.js';

/**
 * Defines a material sampled by the pathtracer
 */
export class PathtracingMaterial {

	constructor() {

		this.rng = {
			_value: null,
			init: proxyFn( 'rng._value.init', this ),
			nextBounce: proxyFn( 'rng._value.nextBounce', this ),
			f32: proxyFn( 'rng._value.f32', this ),
			vec2f: proxyFn( 'rng._value.vec2f', this ),
			vec3f: proxyFn( 'rng._value.vec3f', this ),
			vec4f: proxyFn( 'rng._value.vec4f', this ),
		};

	}

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

	/**
	 * rng: { init, nextBounce, f32, vec2f, vec3f, vec4f }
	 */
	setRandomFunctions( rng ) {

		this.rng._value = rng;

	}

	getData() {

		return {

			bsdfSample: this.getBsdfNode(),

		};

	}

}
