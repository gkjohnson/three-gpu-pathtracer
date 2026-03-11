import { DataTexture, Matrix3, IndirectStorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, texture, sampler, storage, textureStore, globalId } from 'three/tsl';
import { pcgRand2, pcgInit } from '../../nodes/random.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy } from '../../lib/nodes/NodeProxy.js';
import { sampleEnvironmentFn, weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { packCompensationFn, unpackCompensationFn } from '../../nodes/f16packing.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),
			compensationTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ).toReadOnly(),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toReadOnly(),

			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			hitQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

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

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let rayQueueSize = &${ params.rayQueueSize };

				let hitQueue = &${ params.hitQueue };
				let hitQueueSize = &${ params.hitQueueSize };

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
				let rayIndex = ( globalId.x + rayQueueSize[ 0 ] );
				if ( rayIndex >= rayQueueSize[ 1 ] ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = rayQueue[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;
				let seed = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + input.currentBounce;

				${ pcgInit }( indexUV, seed );

				// run intersection
				let ray = Ray( input.origin, input.direction );
				let hitResult = ${ raycastFirstHitFn }( ray );
				if ( hitResult.didHit ) {

					// TODO: we process all of these materials immediately to push to the ray queue
					let index = atomicAdd( &hitQueueSize[ 1 ], 1 );
					hitQueue[ index ].view = - input.direction;
					hitQueue[ index ].indices = hitResult.indices.xyz;
					hitQueue[ index ].barycoord = hitResult.barycoord;
					hitQueue[ index ].normal = hitResult.normal.xyz;
					hitQueue[ index ].side = hitResult.side;
					hitQueue[ index ].pixel_x = input.pixel.x;
					hitQueue[ index ].pixel_y = input.pixel.y;
					hitQueue[ index ].objectIndex = hitResult.objectIndex;
					hitQueue[ index ].throughputColor = input.throughputColor;
					hitQueue[ index ].currentBounce = input.currentBounce;
					hitQueue[ index ].pcgStateS0 = input.pcgStateS0;

				} else {

					var resultColor: vec4f;
					if ( input.currentBounce > 0u ) {

						resultColor = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, input.direction, ${ pcgRand2 }() ) * vec4f( input.throughputColor, 1.0 );

					} else {

						resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, input.direction, ${ pcgRand2 }() );

					}

					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let compensation = ${ unpackCompensationFn }( textureLoad( ${ params.compensationTarget }, indexUV ).r, prevColor );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor + compensation, resultColor, 1.0 / f32( sampleCount ) );
					let storedColor = quantizeToF16( blendedColor );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, storedColor );
					textureStore( ${ params.compensationTarget }, indexUV, vec4u( ${ packCompensationFn }( blendedColor - storedColor, storedColor ) ) );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
