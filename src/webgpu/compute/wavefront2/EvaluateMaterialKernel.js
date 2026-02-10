import { ComputeKernel } from '../ComputeKernel';
import { wgslFn, storage, uniform, globalId, localId } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';
import { pathStateStruct } from '../../nodes/structs.wgsl';
import { pbrtBsdfFunc, getSurfaceRecordFunc } from '../../nodes/sampling.wgsl';
import { materialStruct } from '../../nodes/structs.wgsl';
import { intersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { pcgInit, pcgRand3 } from '../../nodes/random.wgsl';
import { constants, inputQueueSizeWGMem } from '../../nodes/structs.wgsl';

export class EvaluateMaterialKernel extends ComputeKernel {

	constructor(
		pathState = new StorageBufferAttribute(),
		extensionRayQueue = new StorageBufferAttribute(),
		materialEvalQueue = new StorageBufferAttribute(),
		queueSizes = new StorageBufferAttribute(),

		geomNormals = new StorageBufferAttribute(),
		materials = new StorageBufferAttribute(),
	) {

		const params = {
			pathState: storage( pathState, 'PathState' ),
			inputQueue: storage( materialEvalQueue, 'uint' ).toReadOnly(),
			extensionRayQueue: storage( extensionRayQueue, 'uint' ),
			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),

			geomNormals: storage( geomNormals, 'vec3' ).toReadOnly(),
			materials: storage( materials, 'Material' ).toReadOnly(),
			seed: uniform( 0 ),

			globalId: globalId,
			localId: localId,
		};

		const kernel = wgslFn( /* wgsl */ `
			fn bsdf(
				pathState: ptr<storage, array<PathState>, read_write>,
				inputQueue: ptr<storage, array<u32>, read>,
				extensionRayQueue: ptr<storage, array<u32>, read_write>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

				geomNormals: ptr<storage, array<vec3f>, read>,
				materials: ptr<storage, array<Material>, read>,
				seed: u32,

				globalId: vec3u,
				localId: vec3u,
			) -> void {

				if ( localId.x == 0 ) {
					let queueSize = atomicLoad( &queueSizes[1] );

					inputQueueSize = queueSize;
				}

				workgroupBarrier();

				if (globalId.x >= inputQueueSize) {
					return;
				}

				let pathIndex = inputQueue[globalId.x];

				g_state = pathState[ pathIndex ].pcgState;

				var record: ScatterRecord;

				let material = materials[ pathState[ pathIndex ].materialIndex ];

				let dist = pathState[ pathIndex ].dist;
				let hit = IntersectionResult(
					pathState[ pathIndex ].didHit == 1,
					vec4u( pathState[ pathIndex ].indices, 0 ),
					pathState[ pathIndex ].normal,
					pathState[ pathIndex ].barycoord,
					pathState[ pathIndex ].side,
					dist
				);
				let surf = getSurfaceRecord( material, hit, geomNormals, geomNormals );

				let direction = pathState[ pathIndex ].ray.direction;
				let scatterRec = bsdfSample( - direction, surf );

				pathState[ pathIndex ].color = scatterRec.color;
				pathState[ pathIndex ].pdf = scatterRec.pdf;
				pathState[ pathIndex ].pcgState = g_state;

				if ( scatterRec.pdf <= 0 ) {

					pathState[ pathIndex ].throughputColor = vec3f( 0.0 );
					return;

				}

				let origin = pathState[ pathIndex ].ray.origin;
				pathState[ pathIndex ].ray.origin = origin + dist * direction;
				pathState[ pathIndex ].ray.direction = scatterRec.direction;

				let index = atomicAdd( &queueSizes[2], 1 );
				extensionRayQueue[ index ] = pathIndex;

			}
		`, [
			pbrtBsdfFunc,
			materialStruct,
			intersectionResultStruct,
			pathStateStruct,
			inputQueueSizeWGMem,
			pcgInit,
			pcgRand3,
			getSurfaceRecordFunc,
			constants
		] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
