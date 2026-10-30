import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { mediumStackEnterFunc, mediumStackExitFunc, mediumShadowTransmittanceFunc } from '../../nodes/medium.wgsl.js';
import { offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { rayQueueStruct, intersectionResultStruct } from './structs.js';

// Pure BVH traversal over the queued shadow rays. Uses first-hit traversals without face culling
// ( no dedicated any-hit traversal exists yet ), passing fog volume boundaries and accumulating the
// transmittance of the volumes on the way. Any other hit occludes the light.
export class TraceShadowRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {

			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			// TODO: two elements so the placeholder compiles as an array. Remove once three declares every
			// storage buffer as an array, in r187
			shadowRayIntersectionsStorage: storage( new StorageBufferAttribute( 2, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastShadowFn = contextProxy( 'bvhData.fns.raycastShadow' );

		const transformsNode = contextProxy( 'bvhData.storage.transforms' );
		const materialsNode = contextProxy( 'bvhData.storage.materials' );
		const mediumStackEnterFn = mediumStackEnterFunc( transformsNode, materialsNode );
		const mediumStackExitFn = mediumStackExitFunc( transformsNode );
		const mediumShadowTransmittanceFn = mediumShadowTransmittanceFunc( raycastShadowFn, raycastOutput, offsetRayOriginFunc, transformsNode, materialsNode, mediumStackEnterFn, mediumStackExitFn );

		const fn = wgslTagFn /* wgsl */`

			fn compute( globalId: vec3u ) -> void {

				let shadowRayQueue = &${ params.shadowRayQueue };
				let shadowRayIntersectionsStorage = &${ params.shadowRayIntersectionsStorage };

				let index = globalId.x;
				if ( index >= shadowRayQueue.length ) {

					return;

				}

				let queuedRay = ( *shadowRayQueue ).elements[ index ];
				let indexUV = vec2u( queuedRay.pixelIndex >> 16, queuedRay.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, queuedRay.seed, queuedRay.currentBounce + queuedRay.alphaDepth );

				let ray = Ray( queuedRay.origin, queuedRay.direction, queuedRay.maxDist );
				var forwardBlocked = false;
				let transmittance = ${ mediumShadowTransmittanceFn }( ray, queuedRay.mediumStack, &forwardBlocked );

				// an occluded ray reads as a hit
				shadowRayIntersectionsStorage[ index ].objectIndex = select( 0, - 1, any( transmittance > vec3f( 0.0 ) ) );
				shadowRayIntersectionsStorage[ index ].transmittance = transmittance;
				shadowRayIntersectionsStorage[ index ].forwardBlocked = u32( forwardBlocked );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
