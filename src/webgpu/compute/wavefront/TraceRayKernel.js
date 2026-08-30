import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, globalId } from 'three/tsl';
import { proxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, intersectionResultStruct } from './structs.js';

// Pure BVH traversal over the queued bounce rays: one thread per queued ray, writing a compact
// intersection result at the ray's queue index for LogicKernel to consume next frame.
export class TraceRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },

			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			rayIntersections: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );

		const fn = wgslTagFn /* wgsl */`

			fn compute( globalId: vec3u ) -> void {

				let rayQueue = &${ params.rayQueue };
				let rayIntersections = &${ params.rayIntersections };

				let index = globalId.x;
				if ( index >= rayQueue.length ) {

					return;

				}

				let queuedRay = rayQueue.elements[ index ];
				let indexUV = vec2u( queuedRay.pixelIndex >> 16, queuedRay.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, queuedRay.seed, queuedRay.currentBounce + queuedRay.alphaDepth );

				let ray = Ray( queuedRay.origin, queuedRay.direction );
				var hitResult: ${ raycastOutput };
				if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

					rayIntersections[ index ].barycoord = hitResult.barycoord;
					rayIntersections[ index ].objectIndex = i32( hitResult.objectIndex );
					rayIntersections[ index ].position = ray.origin + ray.direction * hitResult.dist;
					rayIntersections[ index ].dist = hitResult.dist;
					rayIntersections[ index ].normal = hitResult.normal.xyz;
					rayIntersections[ index ].side = hitResult.side;
					rayIntersections[ index ].indices = hitResult.indices.xyz;

				} else {

					rayIntersections[ index ].objectIndex = - 1;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
