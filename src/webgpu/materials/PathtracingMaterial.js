import { wgslTagFn } from '../lib/three-mesh-bvh/index.js';
import { rand2, RNG_INDEX_SCATTER_DIRECTION } from '../nodes/random.wgsl.js';
import { diffuseDirectionFunc } from '../nodes/sampling.wgsl.js';

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

		return wgslTagFn`

			fn bsdfSample( worldWo: vec3f, surf: SurfaceRecord ) -> ScatterRecord {

				var record: ScatterRecord;

				let wo = normalize( surf.normalInvBasis * worldWo );
				let wi = ${ diffuseDirectionFunc }( wo, ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } ) );
				record.color = surf.color * max( wi.z, 0.0 );
				record.pdf = max( wi.z, 0.0 ) / PI;
				record.direction = normalize( surf.normalBasis * wi );

				return record;

			}

		`;

	}

	getData() {

		return {

			bsdfSample: this.getBsdfNode(),

		};

	}

}
