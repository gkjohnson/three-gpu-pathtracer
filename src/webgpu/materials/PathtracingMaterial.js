// import { lambertBsdfFunc } from '../nodes/material.wgsl.js';
import { proxyFn } from '../lib/nodes/NodeProxy.js';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';
import { RNG_INDEX_SCATTER_DIRECTION } from '../nodes/random.wgsl.js';
import { diffuseDirectionFunc } from '../nodes/sampling.wgsl.js';

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

		return wgslTagFn`

			fn bsdfSample( worldWo: vec3f, surf: SurfaceRecord ) -> ScatterRecord {

				var record: ScatterRecord;

				let wo = normalize( surf.normalInvBasis * worldWo );
				let wi = ${ diffuseDirectionFunc }( wo, ${ this.rng.vec2f }( ${ RNG_INDEX_SCATTER_DIRECTION } ) );
				record.color = surf.color * max( wi.z, 0.0 );
				record.pdf = max( wi.z, 0.0 ) / PI;
				record.direction = normalize( surf.normalBasis * wi );

				return record;

			}

		`;

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
