import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { rngInit, rand2, RNG_INDEX_BACKGROUND_SAMPLE } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, hitQueueAtomicStruct } from './structs.js';
import { SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { lightRecordStruct } from '../../nodes/structs.wgsl.js';
import { LIGHT_FAR_DISTANCE } from '../../nodes/lights.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../../constants.js';
import { clampPathContributionFunc } from '../../nodes/utils.wgsl.js';

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
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueAtomicStruct ),

			// settings
			misEnabled: uniform( 1, 'uint' ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		// environment + background resources
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute(
				// settings
				misEnabled: u32,
				clampDirect: f32,
				clampIndirect: f32,

				transmissiveBackground: u32,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };

				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( &rayQueue.elements );
				let rayIndex = ( globalId.x + rayQueue.start );
				if ( rayIndex >= rayQueue.end ) {

					return;

				}

				// get the ray info
				let input = rayQueue.elements[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce + input.alphaDepth );

				// one-sample NEE selection normalization (lights + env)
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

				// forward hits: a bsdf-sampled ray that lands on a area light. MIS-weighted
				// only when NEE is also sampling the lights
				if ( input.currentBounce > 0u ) {

					for ( var li = 0u; li < lightsCount; li ++ ) {

						var lightRec: ${ lightRecordStruct };
						if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

							var misWeight = 1.0;
							if ( misEnabled != 0u ) {

								let lightPdf = lightRec.pdf / lightsDenom;
								misWeight = ${ misHeuristicFn }( input.bsdfPdf, lightPdf );

							}

							let lightHit = ${ clampPathContributionFunc }( lightRec.emission * input.throughputColor * misWeight, input.currentBounce + 1u, clampDirect, clampIndirect );
							resultColor += vec4f( lightHit, 0.0 );

						}

					}

				}

				if ( didHit ) {

					// TODO: we process all of these materials immediately to push to the ray queue
					let index = atomicAdd( &hitQueue.end, 1 );
					hitQueue.elements[ index ].view = - input.direction;
					hitQueue.elements[ index ].indices = hitResult.indices.xyz;
					hitQueue.elements[ index ].barycoord = hitResult.barycoord.xy;
					hitQueue.elements[ index ].normal = hitResult.normal.xyz;
					hitQueue.elements[ index ].side = hitResult.side;
					hitQueue.elements[ index ].pixel_x = indexUV.x;
					hitQueue.elements[ index ].pixel_y = indexUV.y;
					hitQueue.elements[ index ].objectIndex = hitResult.objectIndex;
					hitQueue.elements[ index ].throughputColor = input.throughputColor;
					hitQueue.elements[ index ].currentBounce = input.currentBounce;
					hitQueue.elements[ index ].resultColor = resultColor;
					hitQueue.elements[ index ].seed = input.seed;
					hitQueue.elements[ index ].dist = hitResult.dist;
					hitQueue.elements[ index ].transmissiveRay = input.transmissiveRay;
					hitQueue.elements[ index ].minPdf = input.minPdf;
					hitQueue.elements[ index ].alphaDepth = input.alphaDepth;
					hitQueue.elements[ index ].bsdfPdf = input.bsdfPdf;
					hitQueue.elements[ index ].dispersionWavelength = input.dispersionWavelength;

				} else {

					if ( input.currentBounce > 0u && input.transmissiveRay == 0u ) {

						var misWeight = 1.0;
						if ( misEnabled != 0u && envActive ) {

							// match the env pdf scaling used by the NEE selection so the two estimators balance
							let envPdf = ${ getEnvDirPdf }( input.direction ) / lightsDenom;
							misWeight = ${ misHeuristicFn }( input.bsdfPdf, envPdf );

						}

						let environment = ${ sampleEnvColor }( input.direction ).rgb * input.throughputColor * misWeight;
						let contribution = ${ clampPathContributionFunc }( environment, input.currentBounce + 1u, clampDirect, clampIndirect );
						resultColor += vec4f( contribution, 0.0 );

					} else {

						// hit the background
						// support multiple transparent background blending techniques
						let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
						let bg = ${ sampleBackground }( input.direction, rng );
						if ( input.currentBounce == 0u ) {

							// sample the background directly if this is the primary ray
							let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, input.currentBounce + 1u, clampDirect, clampIndirect );
							resultColor = vec4f( background, bg.a );

						} else {

							// transmissive ray handling
							let env = ${ sampleEnvColor }( input.direction );
							let avg = saturate( dot( input.throughputColor, vec3f( 1.0 / 3.0 ) ) );
							let transparency = ( 1.0 - bg.a ) * avg;

							var misWeight = 1.0;
							if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 ) {

								let envPdf = ${ getEnvDirPdf }( input.direction );
								misWeight = ${ misHeuristicFn }( input.bsdfPdf, envPdf );

							}

							if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

								// display the env map through transmissive surfaces
								let background = ${ clampPathContributionFunc }( env.rgb * input.throughputColor * misWeight, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f(
									resultColor.rgb + background,
									1.0,
								);

							} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

								// fade the background by the throughput color average
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * input.throughputColor * misWeight, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f(
									resultColor.rgb + background,
									1.0 - transparency,
								);

							} else {

								// fade the background by the throughput color average, mixing in env lighting
								var light = mix( env.rgb, bg.rgb, bg.a ) * misWeight;
								let background = ${ clampPathContributionFunc }( light * input.throughputColor, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f(
									resultColor.rgb + background,
									1.0 - transparency,
								);

							}

						}

					}

					// store the color rows top down to match a rasterized render target
					let colorIndex = vec2u( indexUV.x, textureDimensions( ${ params.outputTarget } ).y - 1u - indexUV.y );

					// keep the pixel marked as dispatched
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_DISPATCHED_FLAG }u | sampleCount ) );
					textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
