import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, uniform, globalId } from 'three/tsl';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rngNextBounce } from '../../nodes/random.wgsl.js';
import { walkMediumStepFn, MEDIUM_WALK_SURFACE, MEDIUM_WALK_TERMINATED } from '../../nodes/medium.wgsl.js';
import { rayDataStruct, intersectionResultStruct, MEDIUM_QUEUE_LENGTH, MEDIUM_QUEUE_HEADER } from './structs.js';

// Random walks through scattering media, as in Cycles' subsurface kernel but capped per pass. A walk that
// reaches a surface hands its hit to LogicKernel like a traced ray, one that doesn't resumes next pass. The
// walk's weight goes into the staged scatter color.
export class SubsurfaceKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			globalSeed: uniform( 0, 'uint' ),
			maxSubsurfaceBounces: uniform( 256, 'uint' ),
			stepsPerPass: uniform( 16, 'uint' ),
			rayCount: uniform( 0, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			mediumQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			rayIntersectionsStorage: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );

		const fn = wgslTagFn/* wgsl */`

			fn compute( globalSeed: u32, maxSubsurfaceBounces: u32, stepsPerPass: u32, rayCount: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let mediumQueue = &${ params.mediumQueue };
				let rayIntersectionsStorage = &${ params.rayIntersectionsStorage };

				if ( globalId.x >= mediumQueue[ ${ MEDIUM_QUEUE_LENGTH }u ] ) {

					return;

				}

				let index = mediumQueue[ ${ MEDIUM_QUEUE_HEADER }u + globalId.x ];
				// whole structs are read from the buffer, not the pointer alias, which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				let medium = input.medium;

				let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
				${ rngInit }( globalSeed, indexUV, input.sampleIndex, input.hit.bounce + input.alphaDepth + input.subsurfaceBounces );

				var ray = Ray( input.origin, input.direction, 0.0 );
				var hitResult: ${ raycastOutput };
				var weight = input.scatterColor;
				var subsurfaceBounces = input.subsurfaceBounces;
				var hasScattered = false;
				var isFinished = false;
				var isTerminated = false;

				for ( var i = 0u; i < stepsPerPass; i ++ ) {

					var stepWeight = vec3f( 0.0 );
					let walkStep = ${ walkMediumStepFn }(
						medium, input.throughputColor * weight / input.scatterPdf, maxSubsurfaceBounces,
						&ray, &hitResult, &stepWeight, &subsurfaceBounces,
					);
					weight *= stepWeight;

					if ( walkStep == ${ MEDIUM_WALK_SURFACE }u ) {

						// The hit fills the ray results from the back, by the walk's medium queue position, while the
						// traced rays fill them from the front. A path slot walking a medium queued no ray this round,
						// so the two ranges never exceed the slot count or overlap
						let resultIndex = rayCount - 1u - globalId.x;
						rayIntersectionsStorage[ resultIndex ].barycoord = hitResult.barycoord;
						// a walk that leaves without hitting anything is a miss, as in the trace kernel
						rayIntersectionsStorage[ resultIndex ].objectIndex = select( - 1, i32( hitResult.objectIndex ), hitResult.didHit );
						rayIntersectionsStorage[ resultIndex ].position = ray.origin + ray.direction * hitResult.dist;
						rayIntersectionsStorage[ resultIndex ].dist = hitResult.dist;
						rayIntersectionsStorage[ resultIndex ].normal = hitResult.normal.xyz;
						rayIntersectionsStorage[ resultIndex ].side = hitResult.side;
						rayIntersectionsStorage[ resultIndex ].indices = hitResult.indices.xyz;
						rayDataStorage[ index ].rayIntersectionIndex = i32( resultIndex );

						isFinished = true;
						break;

					} else if ( walkStep == ${ MEDIUM_WALK_TERMINATED }u ) {

						isTerminated = true;
						break;

					}

					hasScattered = true;
					${ rngNextBounce }();

				}

				// a zeroed pdf terminates the path in LogicKernel
				rayDataStorage[ index ].scatterColor = weight;
				rayDataStorage[ index ].scatterPdf = select( input.scatterPdf, 0.0, isTerminated );
				rayDataStorage[ index ].origin = ray.origin;
				rayDataStorage[ index ].direction = ray.direction;
				rayDataStorage[ index ].subsurfaceBounces = subsurfaceBounces;
				rayDataStorage[ index ].walkPending = select( 1u, 0u, isFinished || isTerminated );
				if ( hasScattered ) {

					rayDataStorage[ index ].mediumScattered = 1u;
					rayDataStorage[ index ].isFullyTransmissive = 0u;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
