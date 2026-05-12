import { globalId, localId, storage, uint } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel';
import { StorageBufferAttribute } from 'three/webgpu';
import { intersectionResultStruct, rayQueueStruct } from './structs';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy';

export class TraceRayKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },

			rayQueue: storage( new StorageBufferAttribute(), rayQueueStruct ),
			rayIntersectionQueue: storage( new StorageBufferAttribute(), intersectionResultStruct ),

			localId: localId,
			globalId: globalId,

		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );
		const threadIdNode = uint( 0 ).toVar( 'g_threadId' );

		const fn = wgslTagFn/* wgsl */`

			fn traceRay( localId: vec3u, globalId: vec3u ) -> void {

				let index = globalId.x;
				let queueSize = atomicLoad( &${ params.rayQueue }.length );
				if ( index >= queueSize ) {

					return;

				}

				${ threadIdNode } = localId.x;
				var hitResult: ${ raycastOutput };
				let didHit = ${ raycastFirstHitFn }( ${ params.rayQueue }.elements[ index ], &hitResult );

				let result = &${ params.rayIntersectionQueue }[ index ];
				if ( didHit ) {

					result.indices = hitResult.indices.xyz;
					result.barycoord = hitResult.barycoord * select( -1.0, 1.0, hitResult.side );
					result.dist = hitResult.dist;
					result.objectIndex = i32( hitResult.objectIndex );
					result.position = hitResult.position;

				} else {

					result.objectIndex = -1;

				}

			}

		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
