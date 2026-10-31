import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { traceQueuedRayStruct, shadowTraceResultStruct, SHADOW_RAY_QUEUE_LENGTH } from './structs.js';

// Pure BVH traversal over the queued shadow rays. Uses an any-hit traversal without face culling that
// passes partially transparent surfaces, accumulating the light they block.
export class TraceShadowRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {

			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), traceQueuedRayStruct ),
			queueCounters: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			shadowRayIntersectionsStorage: storage( new StorageBufferAttribute( 1, 1 ), shadowTraceResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastShadowFn = contextProxy( 'bvhData.fns.raycastShadow' );

		const fn = wgslTagFn /* wgsl */`

			fn compute( globalId: vec3u ) -> void {

				let shadowRayQueue = &${ params.shadowRayQueue };
				let queueCounters = &${ params.queueCounters };
				let shadowRayIntersectionsStorage = &${ params.shadowRayIntersectionsStorage };

				let index = globalId.x;
				if ( index >= queueCounters[ ${ SHADOW_RAY_QUEUE_LENGTH }u ] ) {

					return;

				}

				let queuedRay = shadowRayQueue[ index ];
				let indexUV = vec2u( queuedRay.pixelIndex >> 16, queuedRay.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, queuedRay.seed, queuedRay.rngIndex );

				let ray = Ray( queuedRay.origin, queuedRay.direction, queuedRay.maxDist );
				var hitResult: ${ raycastOutput };
				let occluded = ${ raycastShadowFn }( ray, &hitResult );
				shadowRayIntersectionsStorage[ index ].objectIndex = select( - 1, i32( hitResult.objectIndex ), occluded );
				shadowRayIntersectionsStorage[ index ].forwardBlocked = u32( hitResult.forwardBlocked );
				shadowRayIntersectionsStorage[ index ].occlusion = hitResult.occlusion;

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
