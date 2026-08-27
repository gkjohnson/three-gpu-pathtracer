import { DataTexture, Matrix3, StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, texture, sampler, storage, textureStore, globalId } from 'three/tsl';
import { rngInit, rand2, RNG_INDEX_BACKGROUND_SAMPLE } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, hitQueueAtomicStruct } from './structs.js';
import { SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { proxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { sampleEnvironmentFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../../constants.js';
import { clampPathContributionFunc } from '../../nodes/utils.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueAtomicStruct ),

			// settings
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			background: texture( new DataTexture() ),
			backgroundSampler: sampler( new DataTexture() ),
			backgroundRotation: uniform( new Matrix3() ),
			backgroundIntensity: uniform( 1 ),
			backgroundBlurriness: uniform( 0 ),

			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute(
				// settings
				clampDirect: f32,
				clampIndirect: f32,

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,

				background: texture_2d<f32>,
				backgroundSampler: sampler,
				backgroundRotation: mat3x3f,
				backgroundIntensity: f32,
				backgroundBlurriness: f32,

				transmissiveBackground: u32,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };

				let envInfo = EnvironmentInfo(
					envMapRotation,
					envMapIntensity,
					0.0 // blur,
				);

				let backgroundInfo = EnvironmentInfo(
					backgroundRotation,
					backgroundIntensity,
					backgroundBlurriness,
				);

				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( &rayQueue.elements );
				let rayIndex = ( globalId.x + rayQueue.start );
				if ( rayIndex >= rayQueue.end ) {

					return;

				}

				// get the ray info
				let input = rayQueue.elements[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce );

				// run intersection
				let ray = Ray( input.origin, input.direction );
				var hitResult: ${ raycastOutput };
				if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

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
					hitQueue.elements[ index ].resultColor = input.resultColor;
					hitQueue.elements[ index ].seed = input.seed;
					hitQueue.elements[ index ].dist = hitResult.dist;
					hitQueue.elements[ index ].transmissiveRay = input.transmissiveRay;
					hitQueue.elements[ index ].minPdf = input.minPdf;

				} else {

					let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
					var resultColor = input.resultColor;
					if ( input.currentBounce > 0u && input.transmissiveRay == 0u ) {

						let environment = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, input.direction, rng ).rgb * input.throughputColor;
						let contribution = ${ clampPathContributionFunc }( environment, input.currentBounce + 1u, clampDirect, clampIndirect );
						resultColor += vec4f( contribution, 0.0 );

					} else {

						// hit the background
						// support multiple transparent background blending techniques
						let bg = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, input.direction, rng );
						if ( input.currentBounce == 0u ) {

							// sample the background directly if this is the primary ray
							let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, input.currentBounce + 1u, clampDirect, clampIndirect );
							resultColor = vec4f( background, bg.a );

						} else {

							// transmissive ray handling
							let env = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, input.direction, rng );
							let avg = saturate( dot( input.throughputColor, vec3f( 1.0 / 3.0 ) ) );
							let transparency = ( 1.0 - bg.a ) * avg;

							if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

								// display the env map through transmissive surfaces
								let background = ${ clampPathContributionFunc }( env.rgb * input.throughputColor, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f(
									resultColor.rgb + background,
									1.0,
								);

							} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

								// fade the background by the throughput color average
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * input.throughputColor, input.currentBounce + 1u, clampDirect, clampIndirect );
								resultColor = vec4f(
									resultColor.rgb + background,
									1.0 - transparency,
								);

							} else {

								// fade the background by the throughput color average, mixing in env lighting
								var light = mix( env.rgb, bg.rgb, bg.a );
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
