import { IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { rngInit, rand2, RNG_INDEX_ENVIRONMENT_SAMPLE } from '../../nodes/random.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { lightRecordStruct } from '../../nodes/structs.wgsl.js';
import { LIGHT_FAR_DISTANCE } from '../../nodes/lights.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			envInfo: { value: null },
			backgroundInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ).toReadOnly(),
			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ).toAtomic(),

			// settings
			misEnabled: uniform( 1, 'uint' ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		// environment + background resources pulled off their providers ( embedded functions )
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute(
				// settings
				misEnabled: u32,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };
				let queueSizes = &${ params.queueSizes };

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

				// one-sample NEE selection normalization ( lights + env ), matched with LightConnectionKernel
				let envActive = ${ envTotalSumNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var lightsDenom = f32( lightsCount );
				if ( envActive ) {

					lightsDenom += 1.0;

				}

				// run intersection
				let ray = Ray( input.origin, input.direction );
				var hitResult: ${ raycastOutput };
				let didHit = ${ raycastFirstHitFn }( ray, &hitResult );
				let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

				var resultColor = input.resultColor;

				// forward MIS: a bsdf-sampled ray that lands on a ( non-occluded ) area light.
				// Only area lights can be hit this way; the camera ray is skipped.
				if ( misEnabled != 0u && input.currentBounce > 0u ) {

					for ( var li = 0u; li < lightsCount; li ++ ) {

						var lightRec: ${ lightRecordStruct };
						if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

							let lightPdf = lightRec.pdf / lightsDenom;
							let misWeight = ${ misHeuristicFn }( input.bsdfPdf, lightPdf );
							resultColor += vec4f( lightRec.emission * input.throughputColor * misWeight, 0.0 );

						}

					}

				}

				if ( didHit ) {

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
					hitQueue[ index ].resultColor = resultColor;
					hitQueue[ index ].seed = input.seed;

				} else {

					let rng = ${ rand2 }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
					if ( input.currentBounce > 0u ) {

						var misWeight = 1.0;
						if ( misEnabled != 0u && envActive ) {

							// match the env pdf scaling used by the NEE selection so the two estimators balance
							let envPdf = ${ getEnvDirPdf }( input.direction ) / lightsDenom;
							misWeight = ${ misHeuristicFn }( input.bsdfPdf, envPdf );

						}

						resultColor += ${ sampleEnvColor }( input.direction, rng ) * vec4f( input.throughputColor * misWeight, 0.0 );

					} else {

						resultColor = ${ sampleBackground }( input.direction, rng );

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
