import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rayDataStruct, NO_PIXEL } from './structs.js';
import { SAMPLE_ACTIVE_FLAG } from '../../constants.js';

// Prepares a range of path slots when the pool is resized. Slots added by a grow start idle, as
// MaterialKernel expects. Slots dropped by a shrink mid-path clear their pixel's active flag.
export class ResetSlotsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),
			start: uniform( 0, 'uint' ),
			end: uniform( 0, 'uint' ),
			addingSlots: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( start: u32, end: u32, addingSlots: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };

				let index = start + globalId.x;
				if ( index >= end ) {

					return;

				}

				if ( addingSlots == 0u ) {

					// the path is discarded, so the pixel is no longer active
					let pixelIndex = rayDataStorage[ index ].pixelIndex;
					if ( pixelIndex != ${ NO_PIXEL }u ) {

						let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );
						let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
						textureStore( ${ params.sampleCountTarget }, indexUV, vec4( combinedField & ~${ SAMPLE_ACTIVE_FLAG }u ) );

					}

				} else {

					rayDataStorage[ index ].pixelIndex = ${ NO_PIXEL }u;
					rayDataStorage[ index ].resultColor = vec4f( 0.0 );
					rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
					rayDataStorage[ index ].hit.objectIndex = - 1;
					rayDataStorage[ index ].alphaDepth = 0u;
					rayDataStorage[ index ].rayIntersectionIndex = - 1;
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
