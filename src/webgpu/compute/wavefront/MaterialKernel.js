import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, globalId } from 'three/tsl';
import { contextProxy, contextProxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand1, RNG_INDEX_ALPHA_TEST, RNG_INDEX_RUSSIAN_ROULETTE } from '../../nodes/random.wgsl.js';
import { rayDataStruct, traceQueuedRayStruct, RAY_QUEUE_LENGTH, SHADOW_RAY_QUEUE_LENGTH } from './structs.js';
import {
	mediumStackStruct, addToMediumStackFn, removeFromMediumStackFn, getCombinedMediumFn, getSubsurfaceMediumFn, isSubsurfaceMaterialFn,
	getShadowMediumStackFn, getShadowMediumDepthFn,
} from '../../nodes/medium.wgsl.js';
import { applyDispersionFunc, dispersionColorWeightFunc } from '../../nodes/material.wgsl.js';
import { scatterRecordStruct } from '../../nodes/structs.wgsl.js';
import { isTerminatingScatterFunc, offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { LIGHT_EPSILON } from '../../nodes/lights.wgsl.js';
import { isAuxSurfaceFn } from '../../nodes/auxiliary.wgsl.js';

// Pure material evaluation: live slots evaluate the surface staged by LogicKernel, sample the bsdf, and
// enqueue the next bounce ray plus the NEE shadow ray toward the light LogicKernel selected.
export class MaterialKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			globalSeed: uniform( 0, 'uint' ),
			rayCount: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			maxBounces: uniform( 5, 'uint' ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), traceQueuedRayStruct ),
			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), traceQueuedRayStruct ),
			queueCounters: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ).toAtomic(),

			globalId: globalId,
		};

		const sampleTrianglePointFn = contextProxyFn( 'bvhData.fns.sampleTrianglePoint' );
		const getSurfaceRecordFn = contextProxyFn( 'shadingModel.fns.getSurfaceRecord' );
		const bsdfSampleFn = contextProxyFn( 'shadingModel.fns.bsdfSample' );
		const bsdfEvalPdfFn = contextProxyFn( 'shadingModel.fns.bsdfEvalPdf' );
		const materialsStorage = contextProxy( 'shadingModel.storage.materials' );
		const transformsStorage = contextProxy( 'bvhData.storage.transforms' );

		// Queues the NEE shadow ray from the origin toward the light LogicKernel selected, starting in the given media,
		// and returns its index in the queue. A whole struct is written to the buffer, which Safari needs
		const queueShadowRayFn = wgslTagFn/* wgsl */`
			fn queueShadowRay( input: ${ rayDataStruct }, origin: vec3f, stack: ${ mediumStackStruct } ) -> i32 {

				var queuedRay: ${ traceQueuedRayStruct };
				queuedRay.origin = origin;
				queuedRay.direction = input.lightDirection;
				queuedRay.pixelIndex = input.pixelIndex;
				queuedRay.rngIndex = input.hit.bounce + input.alphaDepth + input.subsurfaceBounces;
				queuedRay.sampleIndex = input.sampleIndex;
				queuedRay.maxDist = input.lightDist * ( 1.0 - ${ LIGHT_EPSILON } );
				queuedRay.mediumDepth = ${ getShadowMediumDepthFn }( stack, queuedRay.maxDist );

				let shadowIndex = atomicAdd( &${ params.queueCounters }[ ${ SHADOW_RAY_QUEUE_LENGTH }u ], 1u );
				${ params.shadowRayQueue }[ shadowIndex ] = queuedRay;
				return i32( shadowIndex );

			}
		`;

		// Queues the path's next segment to be traced. A whole struct is written to the buffer, which Safari needs
		const queueRayFn = wgslTagFn/* wgsl */`
			fn queueRay( index: u32, input: ${ rayDataStruct }, origin: vec3f, direction: vec3f, rngIndex: u32, maxDist: f32 ) -> void {

				var queuedRay: ${ traceQueuedRayStruct };
				queuedRay.origin = origin;
				queuedRay.direction = direction;
				queuedRay.pixelIndex = input.pixelIndex;
				queuedRay.rngIndex = rngIndex;
				queuedRay.sampleIndex = input.sampleIndex;
				queuedRay.maxDist = maxDist;

				let rayIndex = atomicAdd( &${ params.queueCounters }[ ${ RAY_QUEUE_LENGTH }u ], 1u );
				${ params.rayQueue }[ rayIndex ] = queuedRay;
				${ params.rayDataStorage }[ index ].rayIntersectionIndex = i32( rayIndex );

			}
		`;

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				globalSeed: u32,
				rayCount: u32,
				filterGlossy: f32,
				maxTransparentBounces: u32,
				maxBounces: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };

				// bound by "rayCount" rather than the pool length. The dispatch rounds up to the
				// workgroup size and those extra slots hold a zeroed pixel index
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// whole structs are read from the buffer, not the pointer alias, which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.hit.objectIndex >= 0 && input.walkPending == 0u ) {

					// evaluate the surface staged by LogicKernel. Paths still walking a medium have none, and
					// CameraRayKernel starts new paths in the free slots
					let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
					${ rngInit }( globalSeed, indexUV, input.sampleIndex, input.hit.bounce + input.alphaDepth + input.subsurfaceBounces );

					// the medium the path is in, which the bsdf sample may enter or exit
					var medium = input.medium;
					let segmentInMedium = medium.scatters != 0u;
					var throughputColor = input.throughputColor;

					// The vertex's next direction, its evaluation toward the light LogicKernel selected, and where the
					// bounce and shadow rays start
					var scatterRec: ${ scatterRecordStruct };
					var lightEvalColor = vec3f( 0.0 );
					var lightEvalPdf = 0.0;
					var bounceOrigin = input.origin;
					var shadowOrigin = input.origin;
					var shadowStack = medium.stack;
					var emission = vec3f( 0.0 );
					var minPdf = input.minPdf;
					var isFullyTransmissive = 0u;
					var isTerminated = false;

					let objectInfo = ${ transformsStorage }[ u32( input.hit.objectIndex ) ];
					let materialInfo = ${ materialsStorage }[ objectInfo.materialIndex ];

					var vertexData = ${ sampleTrianglePointFn }( input.hit.barycoord, input.hit.indices );
					vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
					vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
					vertexData.position = objectInfo.matrixWorld * vertexData.position;

					let view = - input.direction;

					// blur glossy surfaces after low-probability bounces to suppress fireflies,
					// from the Cycles "filter glossy" approach in integrator/surface_shader.h
					let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

					var surface = ${ getSurfaceRecordFn }( materialInfo, objectInfo.color, vertexData, input.hit, view, blurRoughness );

					// a matte surface hit by the camera ray renders as a fully transparent
					let isMatte = surface.matte && input.hit.bounce == 0u;
					if ( isMatte ) {

						rayDataStorage[ index ].resultColor = vec4f( 0.0 );
						rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// a medium that only absorbs attenuates the segment to the hit
					if ( ! segmentInMedium && any( medium.extinction > vec3f( 0.0 ) ) ) {

						throughputColor *= exp( - medium.extinction * input.hit.dist );
						rayDataStorage[ index ].throughputColor = throughputColor;

					}

					// Stochastically pass through partially transparent surfaces by re-enqueueing
					// the ray at the hit point, advancing the alpha depth but not the bounce count.
					let passesThrough = ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity;
					if ( passesThrough ) {

						// out of transparent bounces, so stop rather than shading a surface that
						// should be invisible. A zeroed throughput terminates in LogicKernel.
						if ( input.alphaDepth >= maxTransparentBounces ) {

							rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
							rayDataStorage[ index ].emission = vec3f( 0.0 );
							rayDataStorage[ index ].lightPdf = 0.0;
							rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
							return;

						}

						let alphaOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.direction, input.hit.normal );
						if ( segmentInMedium ) {

							// inside a medium, SubsurfaceKernel walks on past the surface, from the surface
							rayDataStorage[ index ].walkPending = 1u;
							rayDataStorage[ index ].origin = alphaOrigin;
							rayDataStorage[ index ].rayStart = 0.0;

						} else {

							// the origin advanced to the hit point, so the remaining budget shrinks by the distance already
							// traced. The ray keeps its origin, and only the queued traversal starts past the surface
							${ queueRayFn }(
								index, input, alphaOrigin, input.direction, input.hit.bounce + input.alphaDepth + 1u + input.subsurfaceBounces,
								max( input.maxDist - input.hit.dist, 0.0 ),
							);
							rayDataStorage[ index ].rayStart = input.rayStart + input.hit.dist;

						}

						// the surface is skipped, so no scatter or emission is staged for LogicKernel.
						// "pdf" is left alone so the previous scatter still weights the forward MIS,
						// and "bsdf" matches it so applying the scatter leaves the throughput as is.
						rayDataStorage[ index ].alphaDepth = input.alphaDepth + 1u;
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].scatterColor = vec3f( input.scatterPdf );
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// apply the hero wavelength to dispersive surfaces, folding the spectral weight
					// into the throughput at the path's first dispersive interaction
					let isDispersive = surface.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
					if ( isDispersive ) {

						let wavelength = abs( input.dispersionWavelength );
						${ applyDispersionFunc }( &surface, surface.dispersion, wavelength );
						if ( input.dispersionWavelength < 0.0 ) {

							rayDataStorage[ index ].dispersionWavelength = wavelength;
							throughputColor *= ${ dispersionColorWeightFunc }( wavelength );
							rayDataStorage[ index ].throughputColor = throughputColor;

						}

					}

					// emission, resolved by LogicKernel
					emission = surface.emission;

					// evaluate the bsdf toward the light LogicKernel selected. The light pdf is 0 if NEE is disabled
					if ( input.lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( input.hit, surface, view, input.lightDirection );
						lightEvalColor = evalRec.color;
						lightEvalPdf = evalRec.pdf;
						shadowOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.lightDirection, input.hit.normal );
						shadowStack = ${ getShadowMediumStackFn }(
							medium.stack, objectInfo.materialIndex, input.hit.side, surface.thinWall,
							input.direction, input.lightDirection, input.hit.normal,
						);

					}

					// sample the next bounce direction
					scatterRec = ${ bsdfSampleFn }( input.hit, surface, view );

					// The first surface the path scatters off fills the denoiser's auxiliary images. Until one is
					// found the last mirror or transmission hit stands in, for paths that reach the environment.
					// The albedo is tinted by the throughput of the surfaces looked past to reach it. The packed
					// albedo's alpha marks the surface found
					let auxFound = unpack4x8unorm( input.auxAlbedo ).a != 0.0;
					if ( ! auxFound ) {

						let isAuxSurface = ${ isAuxSurfaceFn }( surface, scatterRec );
						let auxAlbedo = saturate( throughputColor * surface.color );
						rayDataStorage[ index ].auxAlbedo = pack4x8unorm( vec4f( auxAlbedo, select( 0.0, 1.0, isAuxSurface ) ) );
						rayDataStorage[ index ].auxNormal = pack4x8snorm( vec4f( surface.normal, 0.0 ) );

					}

					isTerminated = all( scatterRec.color == vec3f( 0.0 ) ) || ${ isTerminatingScatterFunc }( scatterRec );
					isFullyTransmissive = input.isFullyTransmissive & select( 0u, 1u, scatterRec.isTransmissive );

					// track the smallest pdf seen along the path for the glossy filter
					minPdf = min( input.minPdf, scatterRec.pdf );

					// refracting through a volume's surface enters or exits it
					if ( scatterRec.isTransmissive && ! surface.thinWall ) {

						var stack = medium.stack;
						if ( input.hit.side > 0.0 ) {

							${ addToMediumStackFn }( &stack, objectInfo.materialIndex );

						} else {

							${ removeFromMediumStackFn }( &stack, objectInfo.materialIndex );

						}

						// a subsurface volume isn't on the stack, refracting into one starts a walk through it
						medium = ${ getCombinedMediumFn }( stack );
						if ( input.hit.side > 0.0 && ${ isSubsurfaceMaterialFn }( objectInfo.materialIndex ) ) {

							medium = ${ getSubsurfaceMediumFn }( objectInfo.materialIndex );
							medium.stack = stack;

						}

						// a whole struct is written to the buffer, not through the pointer alias, which Safari fails to compile
						${ params.rayDataStorage }[ index ].medium = medium;

					}

					bounceOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.hit.normal );

					// decide termination now so finished paths skip the bounce trace entirely - a
					// zeroed pdf reads as a terminating scatter in LogicKernel, which still resolves
					// the vertex's emission and NEE before freeing the slot
					let newBounce = input.hit.bounce + 1u;
					isTerminated = isTerminated || newBounce >= maxBounces;

					// russian roulette early out:
					// Matches Cycles path_state_continuation_probability in integrator/path_state.h
					if ( ! isTerminated && newBounce >= 3u ) {

						let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
						let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
						isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
						if ( ! isTerminated ) {

							// fold the survival boost into the scatter color so LogicKernel's
							// throughput update applies it without a separate division
							scatterRec.color /= rrProb;

						}

					}

					// Write the ray storage content here since things like the emissive value is read
					// in the logic kernel on the subsequent frame.
					rayDataStorage[ index ].scatterColor = scatterRec.color;
					rayDataStorage[ index ].scatterPdf = select( scatterRec.pdf, 0.0, isTerminated );
					rayDataStorage[ index ].minPdf = minPdf;
					rayDataStorage[ index ].isFullyTransmissive = isFullyTransmissive;
					rayDataStorage[ index ].emission = emission;
					rayDataStorage[ index ].hit.bounce = newBounce;
					rayDataStorage[ index ].mediumScattered = 0u;

					// the NEE shadow ray below still resolves the vertex's direct light, so only
					// the bounce segment is skipped for finished paths. Inside a medium, SubsurfaceKernel walks it
					if ( ! isTerminated ) {

						rayDataStorage[ index ].origin = bounceOrigin;
						rayDataStorage[ index ].direction = scatterRec.direction;
						rayDataStorage[ index ].rayStart = 0.0;
						if ( medium.scatters != 0u ) {

							rayDataStorage[ index ].walkPending = 1u;

						} else {

							${ queueRayFn }( index, input, bounceOrigin, scatterRec.direction, newBounce + input.alphaDepth + input.subsurfaceBounces, 0.0 );

						}

					}

					// enqueue the shadow ray toward the light LogicKernel selected
					if ( input.lightPdf > 0.0 && lightEvalPdf > 0.0 ) {

						rayDataStorage[ index ].lightBsdf = lightEvalColor;
						rayDataStorage[ index ].lightBsdfPdf = lightEvalPdf;
						rayDataStorage[ index ].shadowRayIntersectionIndex = ${ queueShadowRayFn }( input, shadowOrigin, shadowStack );

					} else {

						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

					}

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
