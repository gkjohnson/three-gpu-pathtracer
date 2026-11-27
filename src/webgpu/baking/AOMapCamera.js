import { rayStruct, wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { rand2, RNG_INDEX_APERTURE_SAMPLE } from '../nodes/random.wgsl.js';
import { sampleHemisphereFn } from '../nodes/sampling.wgsl.js';
import { offsetRayOriginFunc } from '../nodes/utils.wgsl.js';
import { hitRecordStruct } from '../nodes/structs.wgsl.js';
import { UVMapCamera, texelSurfaceStruct } from './UVMapCamera.js';

/**
 * Camera for baking AO maps with `AOMapShadingModel`. Each ray leaves the texel's surface in a cosine
 * weighted direction around its shading normal, normal map included, so the first hit is the occluder.
 */
export class AOMapCamera extends UVMapCamera {

	_getCameraRayNode() {

		const getTexelSurface = this._getTexelSurfaceNode();
		const objects = contextProxy( 'bvhData.storage.objects' );
		const materials = contextProxy( 'shadingModel.storage.materials' );
		const sampleTrianglePoint = contextProxyFn( 'bvhData.fns.sampleTrianglePoint' );
		const getSurfaceRecord = contextProxyFn( 'shadingModel.fns.getSurfaceRecord' );

		return wgslTagFn/* wgsl */`
			fn getCameraRay( pixel: vec2u, sample: vec2f, resolution: vec2f, ray: ptr<function, ${ rayStruct }> ) -> bool {

				var texel: ${ texelSurfaceStruct };
				if ( ! ${ getTexelSurface }( pixel, sample, resolution, &texel ) ) {

					return false;

				}

				// the shading normal from the material
				let objectInfo = ${ objects }[ texel.objectIndex ];
				var vertexData = ${ sampleTrianglePoint }( texel.barycoord, texel.indices, objectInfo.attributesOffset );
				vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vec4f( vertexData.normal.xyz, 0.0 ) );
				vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
				vertexData.position = ( objectInfo.matrixWorld * vec4f( vertexData.position, 1.0 ) ).xyz;

				var hit: ${ hitRecordStruct };
				hit.barycoord = texel.barycoord;
				hit.objectIndex = i32( texel.objectIndex );
				hit.normal = texel.faceNormal;
				hit.side = 1.0;
				hit.indices = texel.indices;

				let materialInfo = ${ materials }[ objectInfo.materialIndex ];
				let surface = ${ getSurfaceRecord }( materialInfo, objectInfo.color, vertexData, hit, texel.faceNormal, 0.0 );

				// sample around the shading normal, mirroring directions below the triangle back above it
				var direction = ${ sampleHemisphereFn }( surface.normal, ${ rand2 }( ${ RNG_INDEX_APERTURE_SAMPLE } ) );
				let below = dot( direction, texel.faceNormal );
				if ( below < 0.0 ) {

					direction -= 2.0 * below * texel.faceNormal;

				}

				ray.direction = direction;
				ray.origin = ${ offsetRayOriginFunc }( texel.position, direction, texel.faceNormal );
				ray.maxDist = 0.0;
				return true;

			}
		`;

	}

}
