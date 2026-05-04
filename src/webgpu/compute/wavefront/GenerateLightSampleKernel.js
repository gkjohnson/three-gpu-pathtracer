import { ComputeKernel } from '../ComputeKernel';
import { texture, sampler, uniform, globalId, storage } from 'three/tsl';
import { StorageBufferAttribute, DataTexture, Matrix3 } from 'three/webgpu';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy';
import { queuedHitStruct, queueSizesStructHitFree } from './structs';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';
import { sobolInit, sobolFuncs, SOBOL_INDEX_ENVIRONMENT_SAMPLE } from '../../nodes/random.wgsl';
import { rayStruct } from '../../lib/wgsl/structs.wgsl';
import { equirectDirectionPdfFunc, equirectUvToDirectionFunc } from '../../nodes/sampling.wgsl';
import { luminanceFunc } from '../../nodes/utils.wgsl';

export class GenerateLightSampleKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			// settings
			seed: uniform( 0 ),

			// rays
			hitQueue: storage( new StorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new StorageBufferAttribute( 1, queueSizesStructHitFree.getLength() ), queueSizesStructHitFree ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			envMapMarginalWeights: texture( new DataTexture() ),
			envMapMarginalWeightsSampler: sampler( new DataTexture() ),

			envMapConditionalWeights: texture( new DataTexture() ),
			envMapConditionalWeightsSampler: sampler( new DataTexture() ),

			totalSum: uniform( 0 ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				seed: u32,

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,

				envMapMarginalWeights: texture_2d<f32>,
				envMapMarginalWeightsSampler: sampler,

				envMapConditionalWeights: texture_2d<f32>,
				envMapConditionalWeightsSampler: sampler,

				totalSum: f32,

				globalId: vec3u
			) -> void {

				let hitQueue = &${ params.hitQueue };
				let queueSizes = &${ params.queueSizes };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( hitQueue );
				let hitIndex = ( globalId.x + queueSizes.hitQueueStart );
				if ( hitIndex >= queueSizes.hitQueueEnd ) {

					return;

				}

				let indexUV = vec2u( hitQueue[ hitIndex ].pixel_x, hitQueue[ hitIndex ].pixel_y );
				let currentBounce = hitQueue[ hitIndex ].currentBounce;
				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ sobolInit }( pixelIndex, seed, currentBounce );

				let uv0 = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
				let v = textureSampleLevel( envMapMarginalWeights, envMapMarginalWeightsSampler, vec2( uv0.x, 0.0 ), 0 ).x;
				let u = textureSampleLevel( envMapConditionalWeights, envMapConditionalWeightsSampler, vec2( uv0.y, v ), 0 ).x;
				let uv = vec2( u, v );

				let direction = normalize( ${ equirectUvToDirectionFunc }( uv ) );
				let color = envMapIntensity * textureSampleLevel( envMap, envMapSampler, uv, 0 ).xyz;

				let resolution = textureDimensions( envMap ).xy;
				let weight = f32( resolution.x * resolution.y ) * ${ luminanceFunc }( color ) / totalSum;
				var envPdf = weight * ${ equirectDirectionPdfFunc }( direction );

				if ( dot( direction, hitQueue[ hitIndex ].normal ) < 0.0 ) {

					envPdf = 0.0;

				}

				if ( envPdf > 0.0 ) {

					let object = transforms[ hitQueue[ hitIndex ].objectIndex ];
					var vertexData = ${ sampleTrianglePointFn }( hitQueue[ hitIndex ].barycoord, hitQueue[ hitIndex ].indices.xyz );
					vertexData.position = object.matrixWorld * vertexData.position;

					var envRay: ${ rayStruct };
					envRay.direction = direction;
					envRay.origin = vertexData.position.xyz;
					var envHitResult: ${ raycastOutput };
					let occluded = ${ raycastFirstHitFn }( envRay, &envHitResult );

					if ( occluded ) {

						envPdf = 0.0;

					}

				}

				hitQueue[ hitIndex ].lightDirection = direction;
				hitQueue[ hitIndex ].lightPdf = envPdf;
				hitQueue[ hitIndex ].lightColor = color;

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
