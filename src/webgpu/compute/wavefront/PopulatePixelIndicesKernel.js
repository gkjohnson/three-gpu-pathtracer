import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, pixelQueueNonAtomicStruct } from './structs.js';

// Runs once per reset: assigns each of the first rayData-pool-count pixels to a path slot and parks
// the overflow pixel indices in the pixel queue. Slots are initialized so LogicKernel skips them and
// MaterialKernel immediately generates fresh camera rays.
//
// TODO: this bakes the slot / queue split at reset, so "frameBudget" cannot change without one.
// Queueing every pixel and having slots pull on demand would let it be tuned per frame, at the cost
// of a real head / tail ring rather than the current exchange.
export class PopulatePixelIndicesKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueNonAtomicStruct ),
			targetDimensions: uniform( new Vector2() ),
			frameBudget: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( targetDimensions: vec2u, frameBudget: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				if ( globalId.x >= targetDimensions.x || globalId.y >= targetDimensions.y ) {

					return;

				}

				let rayCount = min( frameBudget, arrayLength( rayDataStorage ) );
				let pixelCount = targetDimensions.x * targetDimensions.y;
				if ( globalId.x == 0u && globalId.y == 0u ) {

					pixelQueue.current = 0u;
					pixelQueue.elementCount = select( 0u, pixelCount - rayCount, pixelCount >= rayCount );

				}

				let pixelHash = ( globalId.x << 16 ) | globalId.y;
				let pixelIndex = globalId.x + globalId.y * targetDimensions.x;
				if ( pixelIndex < rayCount ) {

					rayDataStorage[ pixelIndex ].pixelIndex = pixelHash;
					rayDataStorage[ pixelIndex ].resultColor = vec4f( 0.0 );
					rayDataStorage[ pixelIndex ].throughputColor = vec3f( 0.0 );
					rayDataStorage[ pixelIndex ].objectIndex = - 1;
					rayDataStorage[ pixelIndex ].alphaDepth = 0u;
					rayDataStorage[ pixelIndex ].rayIntersectionIndex = - 1;
					rayDataStorage[ pixelIndex ].shadowRayIntersectionIndex = - 1;

				} else {

					pixelQueue.elements[ pixelIndex - rayCount ] = pixelHash;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
