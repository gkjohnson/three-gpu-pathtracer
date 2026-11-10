import { wgslTagFn, contextProxy } from 'three-mesh-bvh/webgpu';
import { GLTFShadingModel } from '../shadingModels/GLTFShadingModel.js';
import { rand2, RNG_INDEX_SCATTER_DIRECTION } from '../nodes/random.wgsl.js';
import { diffuseDirectionFunc } from '../nodes/sampling.wgsl.js';
import { hitRecordStruct, scatterRecordStruct } from '../nodes/structs.wgsl.js';

/**
 * Shading model for baking lightmaps. The texel's own surface, the first hit, is treated as a
 * white diffuse so the path accumulates the light arriving there, its irradiance, while every
 * later bounce uses the scene's materials so the indirect light carries their colors. Use with a
 * camera that aims its rays at the texel surface so it is the first hit.
 */
export class LightmapShadingModel extends GLTFShadingModel {

	constructor( ...args ) {

		super( ...args );

		// the texel's white lambertian has f = 1 rather than 1 / PI so the map holds irradiance, so every
		// path carries PI times the throughput a render of it would. The clamps, tuned for the display,
		// would then cut most of the bounced light rather than its fireflies. Bakes stay unbiased instead
		this.allowClamping = false;

	}

	updateFunctions() {

		super.updateFunctions();

		const { structs, fns } = this;
		const gltfGetSurfaceRecord = fns.getSurfaceRecord.proxyNode;
		const gltfBsdfSample = fns.bsdfSample.proxyNode;
		const gltfBsdfEvalPdf = fns.bsdfEvalPdf.proxyNode;

		// the texel's own emission belongs in the emissive map, not the lightmap, and its color is white
		// so the denoiser's albedo guide matches the irradiance being baked
		fns.getSurfaceRecord = wgslTagFn/* wgsl */`

			fn lightmapGetSurfaceRecord(
				material: ${ structs.material },
				objectColor: vec4f,
				vertexData: ${ contextProxy( 'bvhData.structs.attributes' ) },
				hit: ${ hitRecordStruct },
				view: vec3f,
				blurRoughness: f32,
			) -> ${ structs.surfaceRecord } {

				var surf = ${ gltfGetSurfaceRecord }( material, objectColor, vertexData, hit, view, blurRoughness );
				if ( hit.bounce == 0u ) {

					surf.emission = vec3f( 0.0 );
					surf.color = vec3f( 1.0 );

				}

				return surf;

			}

		`;

		// a white lambertian surface at the texel
		fns.bsdfSample = wgslTagFn/* wgsl */`

			fn lightmapBsdfSample( hit: ${ hitRecordStruct }, surf: ${ structs.surfaceRecord }, worldWo: vec3f ) -> ${ scatterRecordStruct } {

				if ( hit.bounce == 0u ) {

					var record: ${ scatterRecordStruct };
					let wo = normalize( surf.normalInvBasis * worldWo );
					let wi = ${ diffuseDirectionFunc }( wo, ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } ) );
					record.color = vec3f( max( wi.z, 0.0 ) );
					record.pdf = max( wi.z, 0.0 ) / PI;
					record.direction = normalize( surf.normalBasis * wi );
					return record;

				}

				return ${ gltfBsdfSample }( hit, surf, worldWo );

			}

		`;

		fns.bsdfEvalPdf = wgslTagFn/* wgsl */`

			fn lightmapBsdfEvalPdf( hit: ${ hitRecordStruct }, surf: ${ structs.surfaceRecord }, worldWo: vec3f, worldWi: vec3f ) -> ${ scatterRecordStruct } {

				if ( hit.bounce == 0u ) {

					var record: ${ scatterRecordStruct };
					record.direction = worldWi;
					let wi = normalize( surf.normalInvBasis * worldWi );
					record.color = vec3f( max( wi.z, 0.0 ) );
					record.pdf = max( wi.z, 0.0 ) / PI;
					return record;

				}

				return ${ gltfBsdfEvalPdf }( hit, surf, worldWo, worldWi );

			}

		`;

	}

}
