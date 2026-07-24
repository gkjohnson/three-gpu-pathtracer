import { IndirectStorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { weightedAlphaBlendFn, sampleEquirectProbabilityFn, misHeuristicFn } from '../../nodes/sampling.wgsl.js';
import { isTerminatingScatterFunc } from '../../nodes/utils.wgsl.js';
import { rngInit, rand2, RNG_INDEX_DIRECT_LIGHT_SAMPLE } from '../../nodes/random.wgsl.js';
import { environmentInfoStruct } from '../../nodes/structs.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },
			envInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),
			misEnabled: uniform( 1, 'uint' ),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ),
			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ).toAtomic(),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );
		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );

		// environment resources pulled off the envInfo provider ( same pattern as the megakernel )
		const envMapNode = proxy( 'envInfo.value.mapNode', params );
		const envMapSamplerNode = proxy( 'envInfo.value.mapSampler', params );
		const envMarginalNode = proxy( 'envInfo.value.marginalNode', params );
		const envMarginalSamplerNode = proxy( 'envInfo.value.marginalSampler', params );
		const envConditionalNode = proxy( 'envInfo.value.conditionalNode', params );
		const envConditionalSamplerNode = proxy( 'envInfo.value.conditionalSampler', params );
		const envRotationNode = proxy( 'envInfo.value.rotationNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				smoothNormals: u32,
				bounces: u32,
				misEnabled: u32,

				globalId: vec3u
			) -> void {

				let envInfo = ${ environmentInfoStruct }(
					${ envRotationNode },
					${ envIntensityNode },
					0.0,
					${ envTotalSumNode },
				);

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };
				let queueSizes = &${ params.queueSizes };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( hitQueue );
				let hitIndex = ( globalId.x + atomicLoad( &queueSizes[ 2 ] ) );
				if ( hitIndex >= atomicLoad( &queueSizes[ 3 ] ) ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce );

				let object = transforms[ input.objectIndex ];
				var material = materials[ object.materialIndex ];

				// apply per-object colors
				material.color *= object.color.rgb;
				material.opacity *= object.color.a;

				let barycoord = vec3( input.barycoord, 1.0 - input.barycoord.x - input.barycoord.y );
				var vertexData = ${ sampleTrianglePointFn }( barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = object.matrixWorld * vertexData.position;

				let surface = ${ getSurfaceRecordFn }( material, vertexData, input.side, input.normal );

				let scatterRec = ${ bsdfSampleFn }( input.view, surface );

				var resultColor = input.resultColor + vec4f( input.throughputColor * surface.emission, 0.0 );

				// next event estimation: importance-sample the environment with an inline shadow test.
				// added into the carried resultColor so it survives to the terminating write.
				const SHADOW_RAY_EPSILON = 1.0e-4;
				if ( misEnabled != 0u && envInfo.totalSum > 0.0 ) {

					let envSample = ${ sampleEquirectProbabilityFn }( ${ envMarginalNode }, ${ envMarginalSamplerNode }, ${ envConditionalNode }, ${ envConditionalSamplerNode }, ${ envMapNode }, ${ envMapSamplerNode }, envInfo.totalSum, ${ rand2 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );
					let worldEnvDir = transpose( envInfo.rotation ) * envSample.direction;
					let evalRec = ${ bsdfEvalPdfFn }( input.view, worldEnvDir, surface );

					if ( envSample.pdf > 0.0 && evalRec.pdf > 0.0 ) {

						let ng = normalize( vertexData.normal.xyz );
						let offsetSign = select( - 1.0, 1.0, dot( ng, worldEnvDir ) > 0.0 );
						let shadowRay = Ray( vertexData.position.xyz + ng * offsetSign * SHADOW_RAY_EPSILON, worldEnvDir );

						var shadowHit: ${ raycastOutput };
						if ( ! ${ raycastFirstHitFn }( shadowRay, &shadowHit ) ) {

							let misW = ${ misHeuristicFn }( envSample.pdf, evalRec.pdf );
							resultColor += vec4f( input.throughputColor * envInfo.intensity * envSample.color * evalRec.color * misW / envSample.pdf, 0.0 );

						}

					}

				}

				let isTerminated = input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				if ( isTerminated ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &queueSizes[ 1 ], 1 ) % rayQueueCapacity;
					rayQueue[ index ].origin = vertexData.position.xyz;
					rayQueue[ index ].direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue[ index ].currentBounce = input.currentBounce + 1;
					rayQueue[ index ].resultColor = resultColor;
					rayQueue[ index ].seed = input.seed;
					rayQueue[ index ].bsdfPdf = scatterRec.pdf;

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
