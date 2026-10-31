import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, intersectionResultStruct } from './structs.js';

// Pure BVH traversal over the queued bounce rays: one thread per queued ray, writing a compact
// intersection result at the ray's queue index for LogicKernel to consume next frame.
export class TraceRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {

			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			// TODO: two elements so the placeholder compiles as an array. Remove once three declares every
			// storage buffer as an array, in r187
			rayIntersectionsStorage: storage( new StorageBufferAttribute( 2, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastFirstHitFn = contextProxy( 'bvhData.fns.raycastFirstHit' );

		const fn = wgslTagFn /* wgsl */`

			fn compute( globalId: vec3u ) -> void {

				let rayQueue = &${ params.rayQueue };
				let rayIntersectionsStorage = &${ params.rayIntersectionsStorage };

				let index = globalId.x;
				if ( index >= rayQueue.length ) {

					return;

				}

				let queuedRay = ( *rayQueue ).elements[ index ];
				let indexUV = vec2u( queuedRay.pixelIndex >> 16, queuedRay.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, queuedRay.seed, queuedRay.rngIndex );

				let ray = Ray( queuedRay.origin, queuedRay.direction, queuedRay.maxDist );
				var hitResult: ${ raycastOutput };
				if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

					rayIntersectionsStorage[ index ].barycoord = hitResult.barycoord;
					rayIntersectionsStorage[ index ].objectIndex = i32( hitResult.objectIndex );
					rayIntersectionsStorage[ index ].position = ray.origin + ray.direction * hitResult.dist;
					rayIntersectionsStorage[ index ].dist = hitResult.dist;
					rayIntersectionsStorage[ index ].normal = hitResult.normal.xyz;
					rayIntersectionsStorage[ index ].side = hitResult.side;
					rayIntersectionsStorage[ index ].indices = hitResult.indices.xyz;

				} else {

					rayIntersectionsStorage[ index ].objectIndex = - 1;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
