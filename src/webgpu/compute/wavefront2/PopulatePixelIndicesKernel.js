import { globalId, storage, uniform } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel';
import { StorageBufferAttribute, Vector2 } from 'three/webgpu';
import { pixelQueueNonAtomicStruct, rayDataStruct } from './structs';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';

export class PopulatePixelIndices extends ComputeKernel {

	constructor() {

		const params = {

			rayData: storage( new StorageBufferAttribute(), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute(), pixelQueueNonAtomicStruct ),

			targetDimensions: uniform( new Vector2() ),

			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`

			fn populatePixelIndices( targetDimensions: vec2u, globalId: vec3u ) -> void {

				if ( any( globalId.xy >= targetDimensions ) ) {

					return;

				}

				let rayCount = arrayLength( &${ params.rayData } );

				if ( globalId.x == 0 && globalId.y == 0 ) {

					let pixelCount = targetDimensions.x * targetDimensions.y;
					${ params.pixelQueue }.elementCount = select( 0, pixelCount - rayCount, pixelCount >= rayCount );

				}

				let pixelHash = ( globalId.x << 16 ) | globalId.y;
				let pixelIndex = globalId.x + globalId.y * targetDimensions.x;
				if ( pixelIndex < rayCount ) {

					${ params.rayData }[ pixelIndex ].pixelIndex = pixelHash;
					${ params.rayData }[ pixelIndex ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );

				} else {

					// TODO: remove atomic here
					${ params.pixelQueue }.elements[ pixelIndex - rayCount ] = pixelHash;

				}

			}

		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
