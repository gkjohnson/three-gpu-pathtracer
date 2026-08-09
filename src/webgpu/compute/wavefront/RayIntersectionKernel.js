import { DataTexture, Matrix3, StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, texture, sampler, storage, textureStore, globalId } from 'three/tsl';
import { rngInit, rand2, RNG_INDEX_ENVIRONMENT_SAMPLE } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, hitQueueAtomicStruct, RAY_FLAG_FULLY_TRANSMISSIVE } from './structs.js';
import { proxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { sampleEnvironmentFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from '../../constants.js';

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

			transmissiveBackground: uniform( 1 ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute(
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
				let ACTIVE_FLAG = 0xF0000000u;
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
					hitQueue.elements[ index ].flags = input.flags;
					hitQueue.elements[ index ].minPdf = input.minPdf;

				} else {

					let rng = ${ rand2 }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
					var resultColor = input.resultColor;
					if ( input.currentBounce > 0u && ( input.flags & ${ RAY_FLAG_FULLY_TRANSMISSIVE }u ) == 0u ) {

						resultColor += ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, input.direction, rng ) * vec4f( input.throughputColor, 0.0 );

					} else {

						// camera rays show the background directly while rays that have only passed
						// through transmissive surfaces handle it based on the transmissive background
						// mode: ENVIRONMENT displays the environment through the glass, TRANSPARENT
						// lets a transparent background composite through by the average transmitted
						// throughput, and OVERLAY does both so the glass keeps a tint matching the
						// rest of the model.
						let bg = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, input.direction, rng );
						if ( input.currentBounce == 0u ) {

							resultColor = vec4f( bg.a * bg.rgb, bg.a );

						} else {

							let env = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, input.direction, rng );
							var light = mix( env.rgb, bg.rgb, bg.a );
							var transparency = ( 1.0 - bg.a ) * saturate( dot( input.throughputColor, vec3f( 1.0 / 3.0 ) ) );
							if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

								light = env.rgb;
								transparency = 0.0;

							} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

								light = bg.a * bg.rgb;

							}

							resultColor = vec4f(
								resultColor.rgb + light * input.throughputColor,
								1.0 - transparency,
							);

						}

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
