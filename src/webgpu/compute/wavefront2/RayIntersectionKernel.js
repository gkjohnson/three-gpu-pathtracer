import { ComputeKernel } from '../ComputeKernel';
import { wgslFn, storage, localId, globalId } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';
import { pathStateStruct } from '../../nodes/structs.wgsl';
import { getVertexAttribute, bvhIntersectFirstHit, constants as bvhConstants } from 'three-mesh-bvh/webgpu';

export class RayIntersectionKernel extends ComputeKernel {

	constructor(
		queueSizes = new StorageBufferAttribute(),

		pathState = new StorageBufferAttribute(),
		extensionRayQueue = new StorageBufferAttribute(),

		geomIndex = new StorageBufferAttribute(),
		geomPosition = new StorageBufferAttribute(),
		bvh = new StorageBufferAttribute(),
	) {

		const params = {
			pathState: storage( pathState, 'PathState' ),
			inputQueue: storage( extensionRayQueue, 'uint' ).toReadOnly(),
			queueSizes: storage( queueSizes, 'uint' ).toReadOnly(),

			geomIndex: storage( geomIndex, 'uvec3' ).toReadOnly(),
			geomPosition: storage( geomPosition, 'vec3' ).toReadOnly(),
			bvh: storage( bvh, 'BVHNode' ).toReadOnly(),

			globalId: globalId,
			localId: localId,
		};

		const kernel = wgslFn( /* wgsl */`

			fn traceRay(
				pathState: ptr<storage, array<PathState>, read_write>,
				inputQueue: ptr<storage, array<u32>, read>,
				queueSizes: ptr<storage, array<u32>, read>,

				geomPosition: ptr<storage, array<vec3f>, read>,
				geomIndex: ptr<storage, array<vec3u>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,

				globalId: vec3u,
				localId: vec3u,
			) -> void {

				let inputQueueSize = queueSizes[2];

				if (globalId.x >= inputQueueSize) {
					return;
				}

				let pathIndex = inputQueue[ globalId.x ];

				let ray = pathState[ pathIndex ].ray;

				let hitResult = bvhIntersectFirstHit( geomIndex, geomPosition, bvh, ray );

				pathState[ pathIndex ].indices = hitResult.indices.xyz;

				if ( hitResult.didHit ) {
					pathState[ pathIndex ].didHit = 1;
				} else {
					pathState[ pathIndex ].didHit = 0;
				}

				pathState[ pathIndex ].normal = hitResult.normal;
				pathState[ pathIndex ].side = hitResult.side;
				pathState[ pathIndex ].barycoord = hitResult.barycoord;
				pathState[ pathIndex ].dist = hitResult.dist;

			}

		`, [
			pathStateStruct,
			getVertexAttribute,
			bvhIntersectFirstHit,
			bvhConstants,
		] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
