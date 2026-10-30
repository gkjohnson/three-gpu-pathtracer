import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { traceQueuedRayStruct, intersectionResultStruct, SHADOW_RAY_QUEUE_LENGTH } from './structs.js';

// Pure BVH traversal over the queued shadow rays. Uses a first-hit traversal without face culling
// ( no dedicated any-hit traversal exists yet ); LogicKernel decides occlusion by comparing the
// hit distance against the light distance.
export class TraceShadowRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {

			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), traceQueuedRayStruct ),
			queueCounters: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			// TODO: two elements so the placeholder compiles as an array. Remove once three declares every
			// storage buffer as an array, in r187
			shadowRayIntersectionsStorage: storage( new StorageBufferAttribute( 2, 1 ), intersectionResultStruct ),

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
				${ rngInit }( indexUV, queuedRay.seed, queuedRay.currentBounce + queuedRay.alphaDepth );

				let ray = Ray( queuedRay.origin, queuedRay.direction, queuedRay.maxDist );
				var hitResult: ${ raycastOutput };
				if ( ${ raycastShadowFn }( ray, &hitResult ) ) {

					shadowRayIntersectionsStorage[ index ].objectIndex = i32( hitResult.objectIndex );
					shadowRayIntersectionsStorage[ index ].dist = hitResult.dist;

				} else {

					shadowRayIntersectionsStorage[ index ].objectIndex = - 1;

				}

				shadowRayIntersectionsStorage[ index ].forwardBlocked = u32( hitResult.forwardBlocked );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
