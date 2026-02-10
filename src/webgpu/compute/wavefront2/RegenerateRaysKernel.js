import { wgslFn, globalId, localId, uniform, storage } from 'three/tsl';
import { Matrix4, Vector2 } from 'three';
import { ComputeKernel } from '../ComputeKernel';
import StorageBufferAttribute from 'three/src/renderers/common/StorageBufferAttribute.js';
import { ndcToCameraRay } from 'three-mesh-bvh/webgpu';
import { pathStateStruct, inputQueueSizeWGMem } from '../../nodes/structs.wgsl';
import { pcgInit, pcgRand2 } from '../../nodes/random.wgsl';

export class RegenerateRaysKernel extends ComputeKernel {

	constructor( ) {

		const params = {

			cameraToModelMatrix: uniform( new Matrix4() ),
			inverseProjectionMatrix: uniform( new Matrix4() ),
			tileOffset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( new Vector2() ),

			pathState: storage( new StorageBufferAttribute(), 'PathState' ),
			inputQueue: storage( new StorageBufferAttribute(), 'uint' ).toReadOnly(),
			extensionRayQueue: storage( new StorageBufferAttribute(), 'uint' ),
			queueSizes: storage( new StorageBufferAttribute(), 'uint' ).toAtomic(),

			seed: uniform( 0 ),
			globalId: globalId,
			localId: localId,

		};

		const kernel = wgslFn( /* wgsl */`
			fn regenerateRays(
				cameraToModelMatrix: mat4x4f,
				inverseProjectionMatrix: mat4x4f,
				tileOffset: vec2u,
				tileSize: vec2u,
				dimensions: vec2u,

				pathState: ptr<storage, array<PathState>, read_write>,
				inputQueue: ptr<storage, array<u32>, read>,
				extensionRayQueue: ptr<storage, array<u32>, read_write>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

				seed: u32,

				globalId: vec3u,
				localId: vec3u,
			) -> void {

				if ( localId.x == 0 ) {
					let queueSize = atomicLoad( &queueSizes[0] );

					inputQueueSize = queueSize;
				}

				workgroupBarrier();

				if ( globalId.x >= inputQueueSize ) {
					return;
				}

				let index = atomicAdd( &queueSizes[2], 1 );

				let pathIndex = inputQueue[ globalId.x ];
				let indexUV = vec2u( pathIndex % tileSize.x, pathIndex / tileSize.x ) + tileOffset;

				let uv = vec2f( indexUV ) / vec2f( dimensions );

				let ndc = uv * 2.0 - vec2f( 1.0 );

				if ( all( pathState[ pathIndex ].pcgState.s0 == vec4u( 0 ) ) ) {
					pcgInitialize(indexUV, seed);
				} else {
					g_state = pathState[ pathIndex ].pcgState;
				}

				let jitter = 2.0 * ( pcgRand2() - vec2( 0.5 ) ) / vec2f( dimensions.xy );

				let ray = ndcToCameraRay( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );

				pathState[ pathIndex ].ray = ray;
				pathState[ pathIndex ].throughputColor = vec3f( 1.0 );
				pathState[ pathIndex ].currentBounce = 0;
				pathState[ pathIndex ].color = vec3f( 1.0 );
				pathState[ pathIndex ].pdf = 1.0;
				pathState[ pathIndex ].pcgState = g_state;
				pathState[ pathIndex ].tileOffset = tileOffset;

				// TODO: Firstly write to workgroup-local memory, then put a bunch inside storage mem
				extensionRayQueue[ index ] = pathIndex;

			}

		`, [ ndcToCameraRay, pathStateStruct, pcgInit, inputQueueSizeWGMem, pcgRand2 ] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
