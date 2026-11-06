import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { stackMediumFn, originMediumStackFn, storeMediumFn } from '../../nodes/medium.wgsl.js';
import { rayDataStruct, WALK_PENDING_CAMERA } from './structs.js';

// Finds the volumes each new camera ray starts inside of by tracing from the ray's own origin, and starts its
// medium with them. Runs after MaterialKernel spawns the camera rays and before they are traced. A camera ray
// starting in a scattering volume is walked by MediumKernel instead, leaving its queued trace unused.
export class CameraMediumKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayCount: uniform( 0, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),

			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`

			fn compute( rayCount: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };

				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// a camera ray spawned this frame: MaterialKernel gave a freed slot a ray to trace. Whole structs are
				// read from the buffer, not the pointer alias, which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.hit.objectIndex >= 0 || input.rayIntersectionIndex < 0 ) {

					return;

				}

				let medium = ${ stackMediumFn }( ${ originMediumStackFn }( input.origin ) );
				rayDataStorage[ index ].medium = ${ storeMediumFn }( medium );

				// the walk hands its hit back in the queued ray's result entry, which its trace leaves unused. Clearing
				// the free slot marker keeps MaterialKernel from respawning the slot and lets QueueMediumWalksKernel
				// queue the walk
				if ( medium.scatters ) {

					rayDataStorage[ index ].walkPending = ${ WALK_PENDING_CAMERA }u;
					rayDataStorage[ index ].hit.objectIndex = 0;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
