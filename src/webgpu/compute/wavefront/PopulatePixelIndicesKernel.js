import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { contextProxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { rayDataStruct, pixelQueueInfoStruct } from './structs.js';

// Runs once per reset: starts the path slots in use idle and queues every pixel. With a sample limit, the
// pixels the camera declines are marked finished instead.
export class PopulatePixelIndicesKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			pixelQueueInfo: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueInfoStruct ),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),
			targetDimensions: uniform( new Vector2() ),
			frameBudget: uniform( 0, 'uint' ),
			maxSamples: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );

		const fn = wgslTagFn/* wgsl */`
			fn compute( targetDimensions: vec2u, frameBudget: u32, maxSamples: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				if ( globalId.x >= targetDimensions.x || globalId.y >= targetDimensions.y ) {

					return;

				}

				let rayCount = min( frameBudget, arrayLength( rayDataStorage ) );
				let pixelIndex = globalId.x + globalId.y * targetDimensions.x;
				if ( pixelIndex < rayCount ) {

					rayDataStorage[ pixelIndex ].resultColor = vec4f( 0.0 );
					rayDataStorage[ pixelIndex ].throughputColor = vec3f( 0.0 );
					rayDataStorage[ pixelIndex ].hit.objectIndex = - 1;
					rayDataStorage[ pixelIndex ].alphaDepth = 0u;
					rayDataStorage[ pixelIndex ].rayIntersectionIndex = - 1;
					rayDataStorage[ pixelIndex ].shadowRayIntersectionIndex = - 1;

				}

				if ( maxSamples != 0u ) {

					${ rngInit }( 0u, globalId.xy, 0u, 0u );
					var ray: ${ rayStruct };
					let center = ( vec2f( globalId.xy ) + 0.5 ) / vec2f( targetDimensions );
					if ( ! ${ getCameraRayFn }( center, vec2f( targetDimensions ), &ray ) ) {

						textureStore( ${ params.sampleCountTarget }, globalId.xy, vec4( maxSamples ) );
						return;

					}

				}

				let queueIndex = atomicAdd( &${ params.pixelQueueInfo }[ 0 ].frontCount, 1u );
				pixelQueue[ queueIndex ] = ( globalId.x << 16 ) | globalId.y;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
