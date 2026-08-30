import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, pixelQueueNonAtomicStruct } from './structs.js';

// Runs once per reset: assigns each of the first rayData-pool-count pixels to a path slot and parks
// the overflow pixel indices in the pixel queue. Slots are initialized so LogicKernel skips them and
// MaterialKernel immediately generates fresh camera rays.
export class PopulatePixelIndicesKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayData: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueNonAtomicStruct ),
			targetDimensions: uniform( new Vector2() ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( targetDimensions: vec2u, globalId: vec3u ) -> void {

				let rayData = &${ params.rayData };
				let pixelQueue = &${ params.pixelQueue };

				if ( globalId.x >= targetDimensions.x || globalId.y >= targetDimensions.y ) {

					return;

				}

				let rayCount = arrayLength( rayData );
				let pixelCount = targetDimensions.x * targetDimensions.y;
				if ( globalId.x == 0u && globalId.y == 0u ) {

					pixelQueue.current = 0u;
					pixelQueue.elementCount = select( 0u, pixelCount - rayCount, pixelCount >= rayCount );

				}

				let pixelHash = ( globalId.x << 16 ) | globalId.y;
				let pixelIndex = globalId.x + globalId.y * targetDimensions.x;
				if ( pixelIndex < rayCount ) {

					rayData[ pixelIndex ].pixelIndex = pixelHash;
					rayData[ pixelIndex ].resultColor = vec4f( 0.0 );
					rayData[ pixelIndex ].throughputColor = vec3f( 0.0 );
					rayData[ pixelIndex ].objectIndex = - 1;
					rayData[ pixelIndex ].alphaDepth = 0u;
					rayData[ pixelIndex ].rayIntersectionIndex = - 1;
					rayData[ pixelIndex ].shadowRayIntersectionIndex = - 1;

				} else {

					pixelQueue.elements[ pixelIndex - rayCount ] = pixelHash;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
