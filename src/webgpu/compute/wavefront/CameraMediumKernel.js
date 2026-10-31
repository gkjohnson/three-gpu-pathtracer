import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { mediumStackEnterFunc, stackMediumFunc, originMediumStackFunc, storeMediumFn, MEDIUM_STACK_EMPTY } from '../../nodes/medium.wgsl.js';
import { rayDataStruct } from './structs.js';

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

		const transformsNode = contextProxy( 'bvhData.storage.transforms' );
		const materialsNode = contextProxy( 'bvhData.storage.materials' );
		const mediumStackEnterFn = mediumStackEnterFunc( transformsNode, materialsNode );
		const stackMediumFn = stackMediumFunc( transformsNode, materialsNode );
		const originMediumStackFn = originMediumStackFunc( raycastFirstHitFn, raycastOutput, offsetRayOriginFunc, transformsNode, materialsNode, mediumStackEnterFn );

		const fn = wgslTagFn/* wgsl */`

			fn compute( rayCount: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };

				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// a camera ray spawned this frame: MaterialKernel gave a freed slot a ray to trace
				let input = ( *rayDataStorage )[ index ];
				if ( input.objectIndex >= 0 || input.rayIntersectionIndex < 0 ) {

					return;

				}

				let medium = ${ stackMediumFn }( ${ originMediumStackFn }( input.origin ), ${ MEDIUM_STACK_EMPTY }u );
				rayDataStorage[ index ].medium = ${ storeMediumFn }( medium );

				// the walk hands its hit back in the slot's own result entry
				if ( medium.inside ) {

					rayDataStorage[ index ].walkPending = 1u;
					rayDataStorage[ index ].objectIndex = 0;
					rayDataStorage[ index ].rayIntersectionIndex = i32( rayCount + index );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
