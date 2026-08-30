import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { proxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, intersectionResultStruct } from './structs.js';

// Pure BVH traversal over the queued shadow rays. Uses the same first-hit traversal as the bounce
// rays ( no dedicated any-hit traversal exists yet ); LogicKernel decides occlusion by comparing the
// hit distance against the light distance.
export class TraceShadowRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },

			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			shadowRayIntersections: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute( globalId: vec3u ) -> void {

				let shadowRayQueue = &${ params.shadowRayQueue };
				let shadowRayIntersections = &${ params.shadowRayIntersections };

				let index = globalId.x;
				if ( index >= shadowRayQueue.length ) {

					return;

				}

				let queuedRay = shadowRayQueue.elements[ index ];
				let indexUV = vec2u( queuedRay.pixelIndex >> 16, queuedRay.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, queuedRay.seed, queuedRay.currentBounce + queuedRay.alphaDepth );

				let ray = Ray( queuedRay.origin, queuedRay.direction );
				var hitResult: ${ raycastOutput };
				if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

					shadowRayIntersections[ index ].objectIndex = i32( hitResult.objectIndex );
					shadowRayIntersections[ index ].dist = hitResult.dist;

				} else {

					shadowRayIntersections[ index ].objectIndex = - 1;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
