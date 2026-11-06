import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { mediumStackEnterFunc, stackMediumFunc, originMediumStackFunc, storeMediumFn } from '../../nodes/medium.wgsl.js';
import { rayDataStruct, WALK_PENDING_CAMERA } from './structs.js';

// Finds the volumes each new camera ray starts inside of by tracing from the ray's own origin, and starts its
// medium with them. Runs after MaterialKernel spawns the camera rays and before they are traced, only for scenes
// with volumes. A camera ray starting in a scattering volume is walked by MediumKernel instead, leaving its queued
// trace unused.
export class CameraMediumKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayCount: uniform( 0, 'uint' ),

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
