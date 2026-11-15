import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, NO_PIXEL_INDEX, PIXEL_QUEUE_ELEMENT_COUNT, PIXEL_QUEUE_HEADER } from './structs.js';

// Gives the path slots joining the active range a pixel from the queue tail, starting them idle as
// MaterialKernel expects. Slots below "freshStart" were active before and still hold their pixel
// and path unless LogicKernel returned it after a shrink. Runs between frames, so nothing else
// touches the queue meanwhile.
export class ResetSlotsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),
			start: uniform( 0, 'uint' ),
			end: uniform( 0, 'uint' ),
			freshStart: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( start: u32, end: u32, freshStart: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				let index = start + globalId.x;
				if ( index >= end ) {

					return;

				}

				if ( index < freshStart && rayDataStorage[ index ].pixelIndex != ${ NO_PIXEL_INDEX }u ) {

					return;

				}

				// active slots never exceed the pixel count, so the queue holds enough for every new slot
				let previousCount = atomicSub( &pixelQueue[ ${ PIXEL_QUEUE_ELEMENT_COUNT }u ], 1u );
				rayDataStorage[ index ].pixelIndex = atomicLoad( &pixelQueue[ ${ PIXEL_QUEUE_HEADER }u + previousCount - 1u ] );
				rayDataStorage[ index ].resultColor = vec4f( 0.0 );
				rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
				rayDataStorage[ index ].hit.objectIndex = - 1;
				rayDataStorage[ index ].alphaDepth = 0u;
				rayDataStorage[ index ].rayIntersectionIndex = - 1;
				rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
