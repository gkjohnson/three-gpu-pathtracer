import { DataTexture, Matrix3, IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, texture, sampler, storage, textureStore, globalId } from 'three/tsl';
import { RNG_INDEX_ENVIRONMENT_SAMPLE } from '../../nodes/random.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy } from '../../lib/nodes/NodeProxy.js';
import { sampleEnvironmentFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor( rngData ) {

		const params = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ).toReadOnly(),
			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ).toAtomic(),

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

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );
		const rng = rngData;

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

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };
				let queueSizes = &${ params.queueSizes };

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
				let queueCapacity = arrayLength( rayQueue );
				let rayIndex = ( globalId.x + atomicLoad( &queueSizes[ 0 ] ) );
				if ( rayIndex >= atomicLoad( &queueSizes[ 1 ] ) ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = rayQueue[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;

				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ rng.init }( pixelIndex, input.seed, input.currentBounce );

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

					let rng = ${ rng.vec2f }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
					var resultColor = input.resultColor;
					if ( input.currentBounce > 0u ) {

						resultColor += ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, input.direction, rng ) * vec4f( input.throughputColor, 0.0 );

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
