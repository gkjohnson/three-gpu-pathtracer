import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, globalId } from 'three/tsl';
import { contextProxy, contextProxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand1, RNG_INDEX_ALPHA_TEST, RNG_INDEX_RUSSIAN_ROULETTE } from '../../nodes/random.wgsl.js';
import { rayDataStruct, traceQueuedRayStruct, RAY_QUEUE_LENGTH, SHADOW_RAY_QUEUE_LENGTH } from './structs.js';
import { addToMediumStackFn, removeFromMediumStackFn, getCombinedMediumFn, getSubsurfaceMediumFn, isSubsurfaceMaterialFn } from '../../nodes/medium.wgsl.js';
import { applyDispersionFunc, dispersionColorWeightFunc } from '../../nodes/material.wgsl.js';
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

		// Queues the NEE shadow ray from the origin toward the light LogicKernel selected, and returns its index in
		// the queue. A whole struct is written to the buffer, which Safari needs
		const queueShadowRayFn = wgslTagFn/* wgsl */`
			fn queueShadowRay( input: ${ rayDataStruct }, origin: vec3f ) -> i32 {

				var queuedRay: ${ traceQueuedRayStruct };
				queuedRay.origin = origin;
				queuedRay.direction = input.lightDirection;
				queuedRay.pixelIndex = input.pixelIndex;
				queuedRay.rngIndex = input.hit.bounce + input.alphaDepth + input.subsurfaceBounces;
				queuedRay.sampleIndex = input.sampleIndex;
				queuedRay.maxDist = input.lightDist * ( 1.0 - ${ LIGHT_EPSILON } );

				let shadowIndex = atomicAdd( &${ params.queueCounters }[ ${ SHADOW_RAY_QUEUE_LENGTH }u ], 1u );
				${ params.shadowRayQueue }[ shadowIndex ] = queuedRay;
				return i32( shadowIndex );

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
				let rayQueue = &${ params.rayQueue };
				let queueCounters = &${ params.queueCounters };

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
					var throughputColor = input.throughputColor;
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

							let alphaIndex = atomicAdd( &queueCounters[ ${ RAY_QUEUE_LENGTH }u ], 1u );
							rayQueue[ alphaIndex ].origin = alphaOrigin;
							rayQueue[ alphaIndex ].direction = input.direction;
							rayQueue[ alphaIndex ].pixelIndex = input.pixelIndex;
							rayQueue[ alphaIndex ].rngIndex = input.hit.bounce + input.alphaDepth + 1u + input.subsurfaceBounces;
							rayQueue[ alphaIndex ].sampleIndex = input.sampleIndex;
							// the origin advanced to the hit point, so the remaining budget shrinks by the
							// distance already traced
							rayQueue[ alphaIndex ].maxDist = max( input.maxDist - input.hit.dist, 0.0 );
							rayDataStorage[ index ].rayIntersectionIndex = i32( alphaIndex );

							// the ray keeps its origin, and only the queued traversal starts past the surface
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

					// sample the next bounce direction and stage the scatter state for LogicKernel
					var scatterRec = ${ bsdfSampleFn }( input.hit, surface, view );
					let newBounce = input.hit.bounce + 1u;

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

					// decide termination now so finished paths skip the bounce trace entirely - a
					// zeroed pdf reads as a terminating scatter in LogicKernel, which still resolves
					// the surface's emission and NEE before freeing the slot
					var isTerminated = newBounce >= maxBounces || all( scatterRec.color == vec3f( 0.0 ) ) || ${ isTerminatingScatterFunc }( scatterRec );

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
					rayDataStorage[ index ].minPdf = min( input.minPdf, scatterRec.pdf );
					rayDataStorage[ index ].isFullyTransmissive = input.isFullyTransmissive & select( 0u, 1u, scatterRec.isTransmissive );
					rayDataStorage[ index ].emission = surface.emission;
					rayDataStorage[ index ].hit.bounce = newBounce;
					rayDataStorage[ index ].mediumScattered = 0u;

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

							medium = ${ getSubsurfaceMediumFn }( objectInfo.materialIndex, stack );

						}

						// a whole struct is written to the buffer, not through the pointer alias, which Safari fails to compile
						${ params.rayDataStorage }[ index ].medium = medium;

					}

					// the NEE shadow ray below still resolves the surface's direct light, so only
					// the bounce segment is skipped for finished paths. Inside a medium, SubsurfaceKernel walks it
					if ( ! isTerminated && medium.scatters != 0u ) {

						rayDataStorage[ index ].walkPending = 1u;
						rayDataStorage[ index ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.hit.normal );
						rayDataStorage[ index ].direction = scatterRec.direction;
						rayDataStorage[ index ].rayStart = 0.0;

					} else if ( ! isTerminated ) {

						let rayIndex = atomicAdd( &queueCounters[ ${ RAY_QUEUE_LENGTH }u ], 1u );
						rayQueue[ rayIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.hit.normal );
						rayQueue[ rayIndex ].direction = scatterRec.direction;
						rayQueue[ rayIndex ].pixelIndex = input.pixelIndex;
						rayQueue[ rayIndex ].rngIndex = newBounce + input.alphaDepth + input.subsurfaceBounces;
						rayQueue[ rayIndex ].sampleIndex = input.sampleIndex;
						rayQueue[ rayIndex ].maxDist = 0.0;
						rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );

						rayDataStorage[ index ].origin = rayQueue[ rayIndex ].origin;
						rayDataStorage[ index ].direction = scatterRec.direction;
						rayDataStorage[ index ].rayStart = 0.0;

					}

					// evaluate the bsdf toward the light LogicKernel selected and enqueue the shadow ray.
					// the light pdf will be 0 if NEE is disabled.
					var lightPdf = input.lightPdf;
					if ( lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( input.hit, surface, view, input.lightDirection );
						if ( evalRec.pdf > 0.0 ) {

							rayDataStorage[ index ].lightBsdf = evalRec.color;
							rayDataStorage[ index ].lightBsdfPdf = evalRec.pdf;

							let shadowOrigin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.lightDirection, input.hit.normal );
							rayDataStorage[ index ].shadowRayIntersectionIndex = ${ queueShadowRayFn }( input, shadowOrigin );

						} else {

							lightPdf = 0.0;

						}

					}

					if ( lightPdf <= 0.0 ) {

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
