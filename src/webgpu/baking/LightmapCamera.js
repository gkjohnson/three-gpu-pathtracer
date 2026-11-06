/** @import { Object3D } from 'three/webgpu' */
import { uniform } from 'three/tsl';
import { rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { UVMapCamera, texelSurfaceStruct } from './UVMapCamera.js';

/**
 * Camera for baking lightmaps with `LightmapShadingModel`. Each ray lands on the texel's surface, so the
 * tracer shades the texel as the first hit with light sampling.
 */
export class LightmapCamera extends UVMapCamera {

	/**
	 * @param {Object3D} root - A mesh or hierarchy whose indexed meshes share one "uv1" atlas.
	 * @param {Object} [options]
	 * @param {number} [options.originOffset=1e-4] - Distance above the surface the ray starts.
	 */
	constructor( root, options = {} ) {

		super( root );

		const { originOffset = 1e-4 } = options;
		this.originOffset = uniform( originOffset );

	}

	_getCameraRayNode() {

		const getTexelSurface = this._getTexelSurfaceNode();
		const { originOffset } = this;

		return wgslTagFn/* wgsl */`
			fn getCameraRay( uvIn: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

				var texel: ${ texelSurfaceStruct };
				if ( ! ${ getTexelSurface }( uvIn, &texel ) ) {

					return false;

				}

				ray.origin = texel.position + texel.faceNormal * ${ originOffset };
				ray.direction = - texel.faceNormal;
				ray.maxDist = 2.0 * ${ originOffset };
				return true;

			}
		`;

	}

}
