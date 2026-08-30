import { Vector2 } from 'three';
import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxy, proxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand1, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_ALPHA_TEST } from '../../nodes/random.wgsl.js';
import { rayDataStruct, rayQueueAtomicStruct, pixelQueueStruct } from './structs.js';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';
import { offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';

// Pure material evaluation and ray generation: terminated slots pull a recycled pixel and emit a
// fresh camera ray; live slots evaluate the surface staged by LogicKernel, sample the bsdf, and
// enqueue the next bounce ray plus the NEE shadow ray toward the light LogicKernel selected.
export class MaterialKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			seed: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			maxSamples: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			maxTransparentBounces: uniform( 5, 'uint' ),

			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			rayData: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueStruct ),

			globalId: globalId,
		};

		const getCameraRayFn = proxyFn( 'bvhData.value.fns.getCameraRay', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				seed: u32,
				targetDimensions: vec2u,
				maxSamples: u32,
				filterGlossy: f32,
				maxTransparentBounces: u32,

				globalId: vec3u
			) -> void {

				let rayData = &${ params.rayData };
				let rayQueue = &${ params.rayQueue };
				let shadowRayQueue = &${ params.shadowRayQueue };
				let pixelQueue = &${ params.pixelQueue };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				let index = globalId.x;
				if ( index >= arrayLength( rayData ) ) {

					return;

				}

				let input = rayData[ index ];
				if ( input.objectIndex < 0 ) {

					// the slot's path has terminated: recycle the pixel through the overflow queue and
					// generate a fresh camera ray
					var pixelIndex = input.pixelIndex;
					if ( pixelQueue.elementCount > 0u ) {

						let queueIndex = atomicAdd( &pixelQueue.current, 1u ) % pixelQueue.elementCount;
						pixelIndex = atomicExchange( &pixelQueue.elements[ queueIndex ], pixelIndex );

					}

					let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );

					// skip the pixel if it has hit the sample limit
					let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
					let samples = ( ${ SAMPLE_COUNT_MASK }u & combinedField );
					let isComplete = maxSamples != 0u && samples >= maxSamples;

					if ( isComplete ) {

						rayData[ index ].pixelIndex = pixelIndex;
						rayData[ index ].rayIntersectionIndex = - 1;
						rayData[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					${ rngInit }( indexUV, seed + samples, 0 );

					let uv = vec2f( indexUV ) / vec2f( targetDimensions );
					let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
					var ray: ${ rayStruct };
					if ( ! ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ), &ray ) ) {

						// the camera declined the pixel, so leave the slot dormant for this round
						rayData[ index ].pixelIndex = pixelIndex;
						rayData[ index ].rayIntersectionIndex = - 1;
						rayData[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					ray.direction = normalize( ray.direction );

					let rayIndex = atomicAdd( &rayQueue.length, 1u );
					rayQueue.elements[ rayIndex ].origin = ray.origin;
					rayQueue.elements[ rayIndex ].direction = ray.direction;
					rayQueue.elements[ rayIndex ].pixelIndex = pixelIndex;
					rayQueue.elements[ rayIndex ].currentBounce = 0u;
					rayQueue.elements[ rayIndex ].seed = seed + samples;
					rayQueue.elements[ rayIndex ].alphaDepth = 0u;

					rayData[ index ].origin = ray.origin;
					rayData[ index ].direction = ray.direction;
					rayData[ index ].pixelIndex = pixelIndex;
					rayData[ index ].seed = seed + samples;
					rayData[ index ].currentBounce = 0u;
					rayData[ index ].throughputColor = vec3f( 1.0 );
					rayData[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
					rayData[ index ].bsdf = vec3f( 1.0 );
					rayData[ index ].pdf = 1.0;
					rayData[ index ].minPdf = 1.0;
					rayData[ index ].transmissiveRay = 1u;
					rayData[ index ].emission = vec3f( 0.0 );
					rayData[ index ].lightPdf = 0.0;
					rayData[ index ].alphaDepth = 0u;
					rayData[ index ].rayIntersectionIndex = i32( rayIndex );
					rayData[ index ].shadowRayIntersectionIndex = - 1;

					// write the active params & dispatched flag
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_ACTIVE_FLAG }u | ${ SAMPLE_DISPATCHED_FLAG }u | samples ) );

				} else {

					// evaluate the surface staged by LogicKernel
					let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
					${ rngInit }( indexUV, input.seed, input.currentBounce + input.alphaDepth );

					let objectInfo = transforms[ u32( input.objectIndex ) ];
					var materialInfo = materials[ objectInfo.materialIndex ];

					// a matte surface hit by the camera ray renders as a fully transparent
					let isMatte = materialInfo.matte != 0 && input.currentBounce == 0u;
					if ( isMatte ) {

						rayData[ index ].resultColor = vec4f( 0.0 );
						rayData[ index ].throughputColor = vec3f( 0.0 );
						rayData[ index ].emission = vec3f( 0.0 );
						rayData[ index ].lightPdf = 0.0;
						rayData[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// apply per-object colors
					materialInfo.color *= objectInfo.color.rgb;
					materialInfo.opacity *= objectInfo.color.a;

					var vertexData = ${ sampleTrianglePointFn }( input.barycoord, input.indices );
					vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
					vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
					vertexData.position = objectInfo.matrixWorld * vertexData.position;

					let view = - input.direction;

					// blur glossy surfaces after low-probability bounces to suppress fireflies,
					// from the Cycles "filter glossy" approach in integrator/surface_shader.h
					let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

					let surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal, view, blurRoughness );

					// Stochastically pass through partially transparent surfaces by re-enqueueing
					// the ray at the hit point, advancing the alpha depth but not the bounce count.
					let passesThrough = ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity;
					if ( passesThrough ) {

						// out of transparent bounces, so stop rather than shading a surface that
						// should be invisible. A zeroed throughput terminates in LogicKernel.
						if ( input.alphaDepth >= maxTransparentBounces ) {

							rayData[ index ].throughputColor = vec3f( 0.0 );
							rayData[ index ].emission = vec3f( 0.0 );
							rayData[ index ].lightPdf = 0.0;
							rayData[ index ].shadowRayIntersectionIndex = - 1;
							return;

						}

						let alphaIndex = atomicAdd( &rayQueue.length, 1u );
						rayQueue.elements[ alphaIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.direction, input.normal );
						rayQueue.elements[ alphaIndex ].direction = input.direction;
						rayQueue.elements[ alphaIndex ].pixelIndex = input.pixelIndex;
						rayQueue.elements[ alphaIndex ].currentBounce = input.currentBounce;
						rayQueue.elements[ alphaIndex ].seed = input.seed;
						rayQueue.elements[ alphaIndex ].alphaDepth = input.alphaDepth + 1u;

						// the surface is skipped, so no scatter or emission is staged for LogicKernel.
						// "pdf" is left alone so the previous scatter still weights the forward MIS,
						// and "bsdf" matches it so applying the scatter leaves the throughput as is.
						rayData[ index ].alphaDepth = input.alphaDepth + 1u;
						rayData[ index ].emission = vec3f( 0.0 );
						rayData[ index ].bsdf = vec3f( input.pdf );
						rayData[ index ].lightPdf = 0.0;
						rayData[ index ].origin = rayQueue.elements[ alphaIndex ].origin;
						rayData[ index ].rayIntersectionIndex = i32( alphaIndex );
						rayData[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// attenuate the light transmitted through the volume when exiting a backface. The
					// staged throughput is read back by LogicKernel when this surface's emission and
					// NEE contribution resolve, matching the megakernel's ordering.
					if ( input.side < 0.0 && materialInfo.transmission > 0.0 ) {

						rayData[ index ].throughputColor = input.throughputColor * ${ transmissionAttenuationFunc }( input.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

					}

					// sample the next bounce direction and stage the scatter state for LogicKernel
					let scatterRec = ${ bsdfSampleFn }( view, surface );
					rayData[ index ].bsdf = scatterRec.color;
					rayData[ index ].pdf = scatterRec.pdf;
					rayData[ index ].minPdf = min( input.minPdf, scatterRec.pdf );
					rayData[ index ].transmissiveRay = input.transmissiveRay & select( 0u, 1u, scatterRec.isTransmissive );
					rayData[ index ].emission = surface.emission;

					let newBounce = input.currentBounce + 1u;

					// TODO: run the bounce limit, russian roulette, terminating scatter and zero
					// throughput checks here and skip the enqueue when they fire. LogicKernel decides
					// them a frame later, so every terminating path traces one segment for nothing
					let rayIndex = atomicAdd( &rayQueue.length, 1u );
					rayQueue.elements[ rayIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.normal );
					rayQueue.elements[ rayIndex ].direction = scatterRec.direction;
					rayQueue.elements[ rayIndex ].pixelIndex = input.pixelIndex;
					rayQueue.elements[ rayIndex ].currentBounce = newBounce;
					rayQueue.elements[ rayIndex ].seed = input.seed;
					rayQueue.elements[ rayIndex ].alphaDepth = input.alphaDepth;
					rayData[ index ].rayIntersectionIndex = i32( rayIndex );

					rayData[ index ].origin = rayQueue.elements[ rayIndex ].origin;
					rayData[ index ].direction = scatterRec.direction;
					rayData[ index ].currentBounce = newBounce;

					// evaluate the bsdf toward the light LogicKernel selected and enqueue the shadow ray
					var lightPdf = input.lightPdf;
					if ( lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( view, input.lightDirection, surface );
						if ( evalRec.pdf > 0.0 ) {

							rayData[ index ].lightBsdf = evalRec.color;
							rayData[ index ].lightBsdfPdf = evalRec.pdf;

							let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
							shadowRayQueue.elements[ shadowIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.lightDirection, input.normal );
							shadowRayQueue.elements[ shadowIndex ].direction = input.lightDirection;
							shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
							shadowRayQueue.elements[ shadowIndex ].currentBounce = input.currentBounce;
							shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
							shadowRayQueue.elements[ shadowIndex ].alphaDepth = input.alphaDepth;
							rayData[ index ].shadowRayIntersectionIndex = i32( shadowIndex );

						} else {

							lightPdf = 0.0;

						}

					}

					if ( lightPdf <= 0.0 ) {

						rayData[ index ].lightPdf = 0.0;
						rayData[ index ].shadowRayIntersectionIndex = - 1;

					}

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
