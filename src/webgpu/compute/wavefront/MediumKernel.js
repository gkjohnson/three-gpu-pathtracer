import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { storage, uniform, globalId } from 'three/tsl';
import { contextProxy, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rngNextBounce, rand2, RNG_INDEX_MEDIUM_DISTANCE, RNG_INDEX_MEDIUM_DIRECTION, RNG_INDEX_MEDIUM_GUIDE } from '../../nodes/random.wgsl.js';
import { LIGHT_FAR_DISTANCE } from '../../nodes/lights.wgsl.js';
import {
	loadMediumFn, loadMediumSegmentFn, storeMediumFn,
	mediumChannelPdfFn, sampleMediumDistanceFn, findMediumOppositeFn, mediumSegmentPdfFn, sampleMediumDirectionFn,
	MEDIUM_THROUGHPUT_EPSILON,
} from '../../nodes/medium.wgsl.js';
import { rayDataStruct, mediumQueueStruct, intersectionResultStruct, MEDIUM_SCATTER_HIT } from './structs.js';

// Random walks through scattering media, as in Cycles' dedicated subsurface kernel, but capped per pass: a
// walk that reaches the surface hands its hit to LogicKernel like a traced ray, and one that doesn't
// resumes in the next pass. The walk's weight is folded into the staged scatter color, which LogicKernel
// applies after resolving the entry surface's lighting.
export class MediumKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			maxVolumeSteps: uniform( 256, 'uint' ),
			stepsPerPass: uniform( 16, 'uint' ),
			rayCount: uniform( 0, 'uint' ),

			// TODO: two elements so the placeholders compile as arrays. Remove once three declares every
			// storage buffer as an array, in r187
			rayDataStorage: storage( new StorageBufferAttribute( 2, 1 ), rayDataStruct ),
			mediumQueue: storage( new StorageBufferAttribute( 1, 1 ), mediumQueueStruct ),
			rayIntersectionsStorage: storage( new StorageBufferAttribute( 2, 1 ), intersectionResultStruct ),

			globalId: globalId,
		};

		const raycastOutput = contextProxy( 'bvhData.fns.raycastFirstHit.outputType' );
		const raycastFirstHitFn = contextProxy( 'bvhData.fns.raycastFirstHit' );

		const fn = wgslTagFn/* wgsl */`

			fn compute( maxVolumeSteps: u32, stepsPerPass: u32, rayCount: u32, globalId: vec3u ) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let mediumQueue = &${ params.mediumQueue };
				let rayIntersectionsStorage = &${ params.rayIntersectionsStorage };

				if ( globalId.x >= atomicLoad( &mediumQueue.length ) ) {

					return;

				}

				let index = mediumQueue.elements[ globalId.x ];
				let input = ( *rayDataStorage )[ index ];
				var medium = ${ loadMediumFn }( input.medium );
				var segment = ${ loadMediumSegmentFn }( input.medium );

				let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, input.seed, input.currentBounce + input.alphaDepth + input.volumeSteps );

				var ray = Ray( input.origin, input.direction, 0.0 );
				var weight = input.scatterColor;
				var volumeSteps = input.volumeSteps;
				var hasScattered = false;
				var isFinished = false;
				var isTerminated = false;

				for ( var i = 0u; i < stepsPerPass; i ++ ) {

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( ray, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					let channelPdf = ${ mediumChannelPdfFn }( input.throughputColor * weight, medium.albedo );
					let scatterDist = ${ sampleMediumDistanceFn }( medium, segment, channelPdf, ${ rand2 }( ${ RNG_INDEX_MEDIUM_DISTANCE } ) );
					if ( medium.firstSegment ) {

						${ findMediumOppositeFn }( &medium, ray.origin, ray.direction, scatterDist, didHit && hitResult.objectIndex == medium.object, hitResult.dist );

					}

					let scattered = scatterDist < surfaceDist;
					let segmentDist = select( surfaceDist, scatterDist, scattered );
					let transmittance = exp( - medium.extinction * segmentDist );
					let distancePdf = dot( channelPdf, ${ mediumSegmentPdfFn }( medium, segment, segmentDist, scattered ) );
					if ( distancePdf <= 0.0 ) {

						isTerminated = true;
						break;

					}

					if ( ! scattered ) {

						// reaching the surface, weighted by the probability of no scatter event before it. The
						// hit goes in the slot's own result entry, past the traced rays' entries
						weight *= transmittance / distancePdf;

						let resultIndex = rayCount + index;
						rayIntersectionsStorage[ resultIndex ].barycoord = hitResult.barycoord;
						// a walk that leaves without hitting anything is a miss, as in the trace kernel
						rayIntersectionsStorage[ resultIndex ].objectIndex = select( - 1, i32( hitResult.objectIndex ), didHit );
						rayIntersectionsStorage[ resultIndex ].position = ray.origin + ray.direction * hitResult.dist;
						rayIntersectionsStorage[ resultIndex ].dist = hitResult.dist;
						rayIntersectionsStorage[ resultIndex ].normal = hitResult.normal.xyz;
						rayIntersectionsStorage[ resultIndex ].side = hitResult.side;
						rayIntersectionsStorage[ resultIndex ].indices = hitResult.indices.xyz;
						rayDataStorage[ index ].rayIntersectionIndex = i32( resultIndex );

						isFinished = true;
						break;

					}

					weight *= medium.albedo * medium.extinction * transmittance / distancePdf;

					// a scatter event in fog is a path vertex where light is sampled, handed to LogicKernel like
					// a surface hit
					if ( medium.fog ) {

						let resultIndex = rayCount + index;
						rayIntersectionsStorage[ resultIndex ].objectIndex = ${ MEDIUM_SCATTER_HIT };
						rayIntersectionsStorage[ resultIndex ].position = ray.origin + ray.direction * scatterDist;
						rayIntersectionsStorage[ resultIndex ].dist = scatterDist;
						rayDataStorage[ index ].rayIntersectionIndex = i32( resultIndex );

						isFinished = true;
						break;

					}

					ray.origin += ray.direction * scatterDist;
					ray.direction = ${ sampleMediumDirectionFn }( medium, ray.origin, ray.direction, ${ rand2 }( ${ RNG_INDEX_MEDIUM_GUIDE } ), ${ rand2 }( ${ RNG_INDEX_MEDIUM_DIRECTION } ), &segment );
					hasScattered = true;

					// the walk doesn't count against the bounce limit, but is capped, and ends once its
					// throughput is negligible
					volumeSteps ++;
					let throughput = input.throughputColor * weight / input.scatterPdf;
					if ( volumeSteps >= maxVolumeSteps || max( max( throughput.r, throughput.g ), throughput.b ) < ${ MEDIUM_THROUGHPUT_EPSILON } ) {

						isTerminated = true;
						break;

					}

					${ rngNextBounce }();

				}

				// a zeroed pdf terminates the path in LogicKernel
				rayDataStorage[ index ].scatterColor = weight;
				rayDataStorage[ index ].scatterPdf = select( input.scatterPdf, 0.0, isTerminated );
				rayDataStorage[ index ].origin = ray.origin;
				rayDataStorage[ index ].direction = ray.direction;
				rayDataStorage[ index ].volumeSteps = volumeSteps;
				rayDataStorage[ index ].walkPending = select( 1u, 0u, isFinished || isTerminated );
				if ( hasScattered ) {

					rayDataStorage[ index ].mediumScattered = 1u;
					rayDataStorage[ index ].isFullyTransmissive = 0u;

				}

				rayDataStorage[ index ].medium = ${ storeMediumFn }( medium, segment );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
