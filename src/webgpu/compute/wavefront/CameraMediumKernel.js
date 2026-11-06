import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { stackMediumFn, getVolumeStackAtPointFn, storeMediumFn } from '../../nodes/medium.wgsl.js';
import { rayDataStruct, WALK_PENDING_CAMERA } from './structs.js';

// Sets the medium of new camera rays from the volumes around their origin. A ray starting in a scattering
// medium is walked instead of traced.
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

				// only camera rays spawned this frame. Whole structs are read from the buffer, not the pointer alias,
				// which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.hit.objectIndex >= 0 || input.rayIntersectionIndex < 0 ) {

					return;

				}

				let medium = ${ stackMediumFn }( ${ getVolumeStackAtPointFn }( input.origin ) );
				rayDataStorage[ index ].medium = ${ storeMediumFn }( medium );

				// walk instead, marking the slot as in use so it's queued for the walk rather than respawned
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
