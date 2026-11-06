import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { mediumStackEnterFunc, stackMediumFunc, sceneMediumStackFn, originMediumStackFunc, storeMediumFn } from '../../nodes/medium.wgsl.js';
import { rayDataStruct, WALK_PENDING_CAMERA } from './structs.js';

// Starts each new camera ray's medium with the scene fog and the volumes it starts inside of, found by tracing from
// the ray's own origin. Runs after MaterialKernel spawns the camera rays and before they are traced, only for scenes
// with fog or volumes. A camera ray starting in a scattering medium is walked by MediumKernel instead, leaving its
// queued trace unused.
export class CameraMediumKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayCount: uniform( 0, 'uint' ),
			hasVolumes: uniform( 0, 'uint' ),
			sceneFog: uniform( 0, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),

			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastFirstHitFn = contextProxy( 'bvhData.fns.raycastFirstHit' );
		const transformsStorage = contextProxy( 'bvhData.storage.transforms' );
		const materialsStorage = contextProxy( 'shadingModel.storage.materials' );
		const mediumStackEnterFn = mediumStackEnterFunc( transformsStorage, materialsStorage );
		const stackMediumFn = stackMediumFunc( transformsStorage, materialsStorage );
		const originMediumStackFn = originMediumStackFunc( raycastFirstHitFn, raycastOutput, transformsStorage, materialsStorage, mediumStackEnterFn );

		const fn = wgslTagFn/* wgsl */`

			fn compute( rayCount: u32, hasVolumes: u32, sceneFog: u32, globalId: vec3u ) -> void {

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

				var stack = ${ sceneMediumStackFn }( sceneFog != 0u );
				if ( hasVolumes != 0u ) {

					stack = ${ originMediumStackFn }( input.origin, stack );

				}

				let medium = ${ stackMediumFn }( stack );
				rayDataStorage[ index ].medium = ${ storeMediumFn }( medium );

				// the walk hands its hit back in the queued ray's result entry, which its trace leaves unused. Clearing
				// the free slot marker lets QueueMediumWalksKernel queue it
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
