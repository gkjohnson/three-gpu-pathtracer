import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, pixelQueueStruct, PIXEL_INDEX_NONE } from './structs.js';

// Puts a range of path slots into the idle state, as MaterialKernel expects for slots it may spawn
// into. With "returnPixels" set, a slot's pixel is appended to the pixel queue first, so slots
// retired by a pool shrink hand their pixels back. Runs between frames, so nothing pulls from the
// queue while it appends.
export class ResetSlotsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueStruct ),
			start: uniform( 0, 'uint' ),
			end: uniform( 0, 'uint' ),
			returnPixels: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( start: u32, end: u32, returnPixels: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				let index = start + globalId.x;
				if ( index >= end ) {

					return;

				}

				if ( returnPixels != 0u ) {

					let pixelIndex = rayDataStorage[ index ].pixelIndex;
					if ( pixelIndex != ${ PIXEL_INDEX_NONE }u ) {

						let queueIndex = atomicAdd( &pixelQueue.elementCount, 1u );
						atomicStore( &pixelQueue.elements[ queueIndex ], pixelIndex );

					}

				}

				rayDataStorage[ index ].pixelIndex = ${ PIXEL_INDEX_NONE }u;
				rayDataStorage[ index ].resultColor = vec4f( 0.0 );
				rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
				rayDataStorage[ index ].objectIndex = - 1;
				rayDataStorage[ index ].alphaDepth = 0u;
				rayDataStorage[ index ].rayIntersectionIndex = - 1;
				rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
