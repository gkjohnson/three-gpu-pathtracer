import { Vector2 } from 'three';
import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxy, proxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand2, RNG_INDEX_RAY_JITTER } from '../../nodes/random.wgsl.js';
import { rayDataStruct, rayQueueAtomicStruct, pixelQueueStruct } from './structs.js';
import { SAMPLE_COUNT_MASK } from '../../constants.js';
import { transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';

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

			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),

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

					// leave the slot dormant once the pixel has taken its full sample budget. The
					// pixel exchange above still rotates the overflow queue, so pixels that are not
					// yet finished keep finding slots.
					if ( maxSamples != 0u && ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u ) >= maxSamples ) {

						rayData[ index ].pixelIndex = pixelIndex;
						rayData[ index ].rayIntersectionIndex = - 1;
						rayData[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					${ rngInit }( indexUV, seed, 0 );

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
					rayQueue.elements[ rayIndex ].seed = seed;

					rayData[ index ].origin = ray.origin;
					rayData[ index ].direction = ray.direction;
					rayData[ index ].pixelIndex = pixelIndex;
					rayData[ index ].seed = seed;
					rayData[ index ].currentBounce = 0u;
					rayData[ index ].throughputColor = vec3f( 1.0 );
					rayData[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
					rayData[ index ].bsdf = vec3f( 1.0 );
					rayData[ index ].pdf = 1.0;
					rayData[ index ].minPdf = 1.0;
					rayData[ index ].transmissiveRay = 1u;
					rayData[ index ].emission = vec3f( 0.0 );
					rayData[ index ].lightPdf = 0.0;
					rayData[ index ].rayIntersectionIndex = i32( rayIndex );
					rayData[ index ].shadowRayIntersectionIndex = - 1;

				} else {

					// evaluate the surface staged by LogicKernel
					let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
					${ rngInit }( indexUV, input.seed, input.currentBounce );

					let objectInfo = transforms[ u32( input.objectIndex ) ];
					var materialInfo = materials[ objectInfo.materialIndex ];

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

					let newOrigin = vertexData.position.xyz;
					let newBounce = input.currentBounce + 1u;
					rayData[ index ].origin = newOrigin;
					rayData[ index ].direction = scatterRec.direction;
					rayData[ index ].currentBounce = newBounce;

					let rayIndex = atomicAdd( &rayQueue.length, 1u );
					rayQueue.elements[ rayIndex ].origin = newOrigin;
					rayQueue.elements[ rayIndex ].direction = scatterRec.direction;
					rayQueue.elements[ rayIndex ].pixelIndex = input.pixelIndex;
					rayQueue.elements[ rayIndex ].currentBounce = newBounce;
					rayQueue.elements[ rayIndex ].seed = input.seed;
					rayData[ index ].rayIntersectionIndex = i32( rayIndex );

					// evaluate the bsdf toward the light LogicKernel selected and enqueue the shadow ray
					var lightPdf = input.lightPdf;
					if ( lightPdf > 0.0 && dot( surface.faceNormal, input.lightDirection ) < 0.0 ) {

						// reject samples that fall below the geometric surface
						lightPdf = 0.0;

					}

					if ( lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( view, input.lightDirection, surface );
						if ( evalRec.pdf > 0.0 ) {

							rayData[ index ].lightBsdf = evalRec.color;
							rayData[ index ].lightBsdfPdf = evalRec.pdf;

							let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
							shadowRayQueue.elements[ shadowIndex ].origin = newOrigin;
							shadowRayQueue.elements[ shadowIndex ].direction = input.lightDirection;
							shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
							shadowRayQueue.elements[ shadowIndex ].currentBounce = input.currentBounce;
							shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
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
