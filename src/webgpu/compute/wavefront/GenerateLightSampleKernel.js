import { ComputeKernel } from '../ComputeKernel';
import { texture, sampler, uniform, globalId, storage, localId, uint } from 'three/tsl';
import { StorageBufferAttribute, DataTexture, Matrix3 } from 'three/webgpu';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy';
import { hitQueueStruct } from './structs';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';
import { sobolInit, sobolFuncs, SOBOL_INDEX_ENVIRONMENT_SAMPLE, SOBOL_INDEX_LIGHT_INDEX } from '../../nodes/random.wgsl';
import { rayStruct } from '../../lib/wgsl/structs.wgsl';
import { equirectDirectionPdfFunc, equirectUvToDirectionFunc } from '../../nodes/sampling.wgsl';
import { inverseMat3x3Func, luminanceFunc } from '../../nodes/utils.wgsl';
import { lightRecordStruct } from '../../nodes/structs.wgsl';
import { isMISWeightLightFunc, LIGHT_TYPE_ENVIRONMENT, sampleRandomLightFunc } from '../../nodes/lights.wgsl';

export class GenerateLightSampleKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },
			material: { value: null },
			lights: { value: null },

			// settings
			seed: uniform( 0 ),

			// rays
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueStruct ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			envMapMarginalWeights: texture( new DataTexture() ),
			envMapMarginalWeightsSampler: sampler( new DataTexture() ),

			envMapConditionalWeights: texture( new DataTexture() ),
			envMapConditionalWeightsSampler: sampler( new DataTexture() ),

			iesProfiles: texture( new DataTexture() ),
			iesProfilesSampler: sampler( new DataTexture() ),
			lightCount: uniform( 0 ),

			totalSum: uniform( 0 ),

			globalId: globalId,
			localId: localId,
		};

		const lightsBuffer = proxy( 'lights.value', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastAnyHitFn = proxy( 'bvhData.value.fns.raycastAnyHit', params );
		const threadIdNode = uint( 0 ).toVar( 'g_threadId' );

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

				iesProfiles: texture_2d_array<f32>,
				iesProfilesSampler: sampler,

				lightCount: u32,

				globalId: vec3u,
				localId: vec3u,
			) -> void {

				let hitQueue = &${ params.hitQueue };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( &hitQueue.elements );
				let hitIndex = ( globalId.x + hitQueue.start );
				if ( hitIndex >= hitQueue.end ) {

					return;

				}
				${ threadIdNode } = localId.x;

				let hit = hitQueue.elements[ hitIndex ];

				let currentBounce = hit.currentBounce;
				let pixelIndex = hit.pixel;
				${ sobolInit }( pixelIndex, seed, currentBounce );

				let lightsDenom = f32( max( lightCount, 1 ) );
				let invEnvMapRotation = ${ inverseMat3x3Func }( envMapRotation );

				let object = transforms[ hit.objectIndex ];
				var vertexData = ${ sampleTrianglePointFn }( hit.barycoord, hit.indices.xyz );
				vertexData.position = object.matrixWorld * vertexData.position;

				let lightType = ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_LIGHT_INDEX } );
				let lightUV = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
				var lightRecord: ${ lightRecordStruct };
				if ( lightType * ( f32( lightCount ) + 1.0 ) > f32( lightCount ) ) {

					let v = textureSampleLevel( envMapMarginalWeights, envMapMarginalWeightsSampler, vec2( lightUV.x, 0.0 ), 0 ).x;
					let u = textureSampleLevel( envMapConditionalWeights, envMapConditionalWeightsSampler, vec2( lightUV.y, v ), 0 ).x;
					let uv = vec2( u, v );

					lightRecord.direction = normalize( ${ equirectUvToDirectionFunc }( uv ) );
					lightRecord.emission = envMapIntensity * textureSampleLevel( envMap, envMapSampler, uv, 0 ).xyz;

					let resolution = textureDimensions( envMap ).xy;
					let weight = f32( resolution.x * resolution.y ) * ${ luminanceFunc }( lightRecord.emission ) / totalSum;
					lightRecord.pdf = weight * ${ equirectDirectionPdfFunc }( lightRecord.direction );
					lightRecord.kind = ${ LIGHT_TYPE_ENVIRONMENT };
					lightRecord.direction = invEnvMapRotation * lightRecord.direction;
					lightRecord.dist = 1e20;

				} else {

					let lightRng = lightType * ( f32( lightCount ) + 1.0 ) / f32( lightCount );
					lightRecord = ${ sampleRandomLightFunc( lightsBuffer ) }(
						lightRng, lightUV, lightCount, vertexData.position.xyz, iesProfiles, iesProfilesSampler
					);

				}

				lightRecord.pdf /= lightsDenom;

				let offsetDir = vertexData.normal.xyz * sign( dot( vertexData.normal.xyz, lightRecord.direction ) );
				let newPoint = vertexData.position.xyz + 1e-3 * offsetDir;

				if ( dot( lightRecord.direction, hit.normal ) < 0.0 ) {

					lightRecord.pdf = 0.0;

				}

				if ( lightRecord.pdf > 0.0 ) {

					var envRay: ${ rayStruct };
					envRay.direction = lightRecord.direction;
					envRay.origin = newPoint;
					var envHitResult: ${ raycastOutput };
					envHitResult.didHit = true;
					envHitResult.dist = lightRecord.dist;
					let occluded = ${ raycastAnyHitFn }( envRay, &envHitResult );

					if ( occluded ) {

						lightRecord.pdf = 0.0;

					}

				}

				hitQueue.elements[ hitIndex ].lightDirection = lightRecord.direction;
				hitQueue.elements[ hitIndex ].lightPdf = lightRecord.pdf * select( - 1.0, 1.0, ${ isMISWeightLightFunc }( lightRecord.kind ) );
				hitQueue.elements[ hitIndex ].lightColor = lightRecord.emission;

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
