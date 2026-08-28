import { StorageBufferAttribute, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, globalId, texture, sampler } from 'three/tsl';
import { hitQueueStruct } from './structs.js';
import { proxy, proxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn } from '../../nodes/sampling.wgsl.js';
import { clampPathContributionFunc, offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { rngInit, rand2, RNG_INDEX_DIRECT_LIGHT_SAMPLE } from '../../nodes/random.wgsl.js';
import { transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';

export class LightConnectionKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },
			envInfo: { value: null },

			// settings
			misEnabled: uniform( 1, 'uint' ),
			filterGlossy: uniform( 1 ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			// rays
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueStruct ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );
		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );

		// environment resources pulled straight off the envInfo provider
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				misEnabled: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,

				globalId: vec3u
			) -> void {

				let hitQueue = &${ params.hitQueue };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any invocations beyond the hit count
				let hitIndex = ( globalId.x + hitQueue.start );
				if ( hitIndex >= hitQueue.end ) {

					return;

				}

				// nothing to do without an importance-sampleable environment
				if ( misEnabled == 0u || ${ envTotalSumNode } <= 0.0 ) {

					return;

				}

				let input = hitQueue.elements[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce );

				// TODO: this material handling / processing is duplicated for primary paths and NEE rays
				let objectInfo = transforms[ input.objectIndex ];
				var materialInfo = materials[ objectInfo.materialIndex ];

				// apply per-object colors
				materialInfo.color *= objectInfo.color.rgb;
				materialInfo.opacity *= objectInfo.color.a;

				let barycoord = vec3( input.barycoord, 1.0 - input.barycoord.x - input.barycoord.y );
				var vertexData = ${ sampleTrianglePointFn }( barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
				vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
				vertexData.position = objectInfo.matrixWorld * vertexData.position;

				// blur glossy surfaces after low-probability bounces, matching ProcessHits so the
				// NEE evaluation sees the same surface record
				let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

				let surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal, input.view, blurRoughness );

				// attenuate the light transmitted through the volume when exiting a backface so the
				// direct-light contribution matches the megakernel's ordering
				var throughputColor = input.throughputColor;
				if ( input.side < 0.0 && materialInfo.transmission > 0.0 ) {

					throughputColor *= ${ transmissionAttenuationFunc }( input.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

				}

				// next event estimation: importance-sample the environment, MIS-weighted against the bsdf pdf.
				let envSample = ${ sampleEnvDir }( ${ rand2 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

				// TODO: do we need to guard against other forms of invalid rays? Eg below the surface?
				let evalRec = ${ bsdfEvalPdfFn }( input.view, envSample.direction, surface );
				if ( envSample.pdf > 0.0 && evalRec.pdf > 0.0 ) {

					var shadowRay: ${ rayStruct };
					shadowRay.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, envSample.direction, input.normal );
					shadowRay.direction = envSample.direction;

					var shadowHit: ${ raycastOutput };
					if ( ! ${ raycastFirstHitFn }( shadowRay, &shadowHit ) ) {

						let misWeight = ${ misHeuristicFn }( envSample.pdf, evalRec.pdf );

						// deposit the contribution in place; ProcessHits reads this augmented resultColor
						let directLight = throughputColor * envSample.color * evalRec.color * misWeight / envSample.pdf;
						let contribution = ${ clampPathContributionFunc }( directLight, input.currentBounce + 1u, clampDirect, clampIndirect );
						hitQueue.elements[ hitIndex ].resultColor += vec4f( contribution, 0.0 );

					}

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
