import { DataTexture, Matrix3, IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, texture, sampler, storage, textureStore, globalId } from 'three/tsl';
import { rngInit, rand2, RNG_INDEX_ENVIRONMENT_SAMPLE } from '../../nodes/random.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { sampleEnvironmentFn, envMapDirectionPdfFn, misHeuristicFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { environmentInfoStruct } from '../../nodes/structs.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ).toReadOnly(),
			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ).toAtomic(),

			// environment ( map / scalars pulled from the envInfo provider via proxies )
			envInfo: { value: null },
			misEnabled: uniform( 1, 'uint' ),

			background: texture( new DataTexture() ),
			backgroundSampler: sampler( new DataTexture() ),
			backgroundRotation: uniform( new Matrix3() ),
			backgroundIntensity: uniform( 1 ),
			backgroundBlurriness: uniform( 0 ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		// environment resources pulled off the envInfo provider ( for escape-to-env MIS )
		const envMapNode = proxy( 'envInfo.value.mapNode', params );
		const envMapSamplerNode = proxy( 'envInfo.value.mapSampler', params );
		const envRotationNode = proxy( 'envInfo.value.rotationNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const envBlurNode = proxy( 'envInfo.value.blurNode', params );
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute(
				// environment
				misEnabled: u32,

				background: texture_2d<f32>,
				backgroundSampler: sampler,
				backgroundRotation: mat3x3f,
				backgroundIntensity: f32,
				backgroundBlurriness: f32,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };
				let queueSizes = &${ params.queueSizes };

				let envInfo = ${ environmentInfoStruct }(
					${ envRotationNode },
					${ envIntensityNode },
					${ envBlurNode },
					${ envTotalSumNode },
				);

				let backgroundInfo = ${ environmentInfoStruct }(
					backgroundRotation,
					backgroundIntensity,
					backgroundBlurriness,
					0.0, // totalSum ( unused for background )
				);

				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( rayQueue );
				let rayIndex = ( globalId.x + atomicLoad( &queueSizes[ 0 ] ) );
				if ( rayIndex >= atomicLoad( &queueSizes[ 1 ] ) ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = rayQueue[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce );

				// run intersection
				let ray = Ray( input.origin, input.direction );
				var hitResult: ${ raycastOutput };
				if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

					// TODO: we process all of these materials immediately to push to the ray queue
					let index = atomicAdd( &queueSizes[ 3 ], 1 );
					hitQueue[ index ].view = - input.direction;
					hitQueue[ index ].indices = hitResult.indices.xyz;
					hitQueue[ index ].barycoord = hitResult.barycoord.xy;
					hitQueue[ index ].normal = hitResult.normal.xyz;
					hitQueue[ index ].side = hitResult.side;
					hitQueue[ index ].pixel_x = indexUV.x;
					hitQueue[ index ].pixel_y = indexUV.y;
					hitQueue[ index ].objectIndex = hitResult.objectIndex;
					hitQueue[ index ].throughputColor = input.throughputColor;
					hitQueue[ index ].currentBounce = input.currentBounce;
					hitQueue[ index ].resultColor = input.resultColor;
					hitQueue[ index ].seed = input.seed;

				} else {

					let rng = ${ rand2 }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
					var resultColor = input.resultColor;
					if ( input.currentBounce > 0u ) {

						// escape-to-env MIS: weight against env sampling so the NEE contribution isn't double counted
						var misW = 1.0;
						if ( misEnabled != 0u && envInfo.totalSum > 0.0 ) {

							let envSpaceDir = envInfo.rotation * input.direction;
							let envPdf = ${ envMapDirectionPdfFn }( ${ envMapNode }, ${ envMapSamplerNode }, envInfo.totalSum, envSpaceDir );
							misW = ${ misHeuristicFn }( input.bsdfPdf, envPdf );

						}

						resultColor += ${ sampleEnvironmentFn }( ${ envMapNode }, ${ envMapSamplerNode }, envInfo, input.direction, rng ) * vec4f( input.throughputColor * misW, 0.0 );

					} else {

						resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, input.direction, rng );

					}

					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
