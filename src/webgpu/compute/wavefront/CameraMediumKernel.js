import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { getCombinedMediumFn, getMediumStackAtPointFn } from '../../nodes/medium.wgsl.js';
import { rayDataStruct, traceQueuedRayStruct, RAY_QUEUE_LENGTH } from './structs.js';

// Sets the medium of the camera rays CameraRayKernel spawned from the volumes around their origin, then queues
// each ray to be traced. Subsurface volumes aren't on the stack, so a camera inside one sees its walls, as in Cycles.
export class CameraMediumKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			rayCount: uniform( 0, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), traceQueuedRayStruct ),
			queueCounters: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),

			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`

			fn compute( rayCount: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let rayQueue = &${ params.rayQueue };
				let queueCounters = &${ params.queueCounters };

				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// only camera rays spawned this round. Whole structs are read from the buffer, not the pointer alias,
				// which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.hit.objectIndex >= 0 || input.rayIntersectionIndex < 0 ) {

					return;

				}

				// a whole struct is written to the buffer, not through the pointer alias, which Safari fails to compile
				let medium = ${ getCombinedMediumFn }( ${ getMediumStackAtPointFn }( input.origin ) );
				${ params.rayDataStorage }[ index ].medium = medium;

				let rayIndex = atomicAdd( &queueCounters[ ${ RAY_QUEUE_LENGTH }u ], 1u );
				rayQueue[ rayIndex ].origin = input.origin;
				rayQueue[ rayIndex ].direction = input.direction;
				rayQueue[ rayIndex ].pixelIndex = input.pixelIndex;
				rayQueue[ rayIndex ].rngIndex = 0u;
				rayQueue[ rayIndex ].sampleIndex = input.sampleIndex;
				rayQueue[ rayIndex ].maxDist = input.maxDist;
				rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
