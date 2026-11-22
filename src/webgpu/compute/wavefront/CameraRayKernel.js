import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { createSampleCountTarget } from '../targets.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { contextProxyFn, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { rngInit, rand1, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_DISPERSION_WAVELENGTH } from '../../nodes/random.wgsl.js';
import { rayDataStruct, pixelQueueInfoStruct, NO_PIXEL } from './structs.js';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_CONVERGED_FLAG, SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH } from '../../nodes/material.wgsl.js';

// queue entries a free slot tries before waiting for the next round
const PIXEL_QUEUE_POP_ATTEMPTS = 4;

// Starts a new path in each slot whose path has ended: pops a pixel from the queue and writes a fresh camera
// ray. CameraMediumKernel then finds the ray's medium and queues it.
export class CameraRayKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			globalSeed: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			maxSamples: uniform( 0, 'uint' ),
			rayCount: uniform( 0, 'uint' ),

			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			pixelQueueInfo: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueInfoStruct ),

			globalId: globalId,
		};

		const getCameraRayFn = contextProxyFn( 'bvhData.fns.getCameraRay' );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				globalSeed: u32,
				targetDimensions: vec2u,
				maxSamples: u32,
				rayCount: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let pixelQueue = &${ params.pixelQueue };

				// bound by "rayCount" rather than the pool length. The dispatch rounds up to the
				// workgroup size and those extra slots hold a zeroed pixel index
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// whole structs are read from the buffer, not the pointer alias, which Safari fails to compile
				let input = ${ params.rayDataStorage }[ index ];
				if ( input.hit.objectIndex >= 0 ) {

					return;

				}

				// pop from the front of the queue, then the back, until a pixel takes a sample
				let frontCount = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].frontCount );
				let backCount = atomicLoad( &${ params.pixelQueueInfo }[ 0 ].backCount );

				var pixelIndex = 0u;
				var indexUV = vec2u( 0u );
				var samples = 0u;
				var ray: ${ rayStruct };
				var hasPixel = false;
				for ( var attempt = 0u; attempt < ${ PIXEL_QUEUE_POP_ATTEMPTS }u; attempt ++ ) {

					var queueIndex = atomicAdd( &${ params.pixelQueueInfo }[ 0 ].frontCursor, 1u );
					if ( queueIndex >= frontCount ) {

						let backIndex = atomicAdd( &${ params.pixelQueueInfo }[ 0 ].backCursor, 1u );
						if ( backIndex >= backCount ) {

							break;

						}

						queueIndex = arrayLength( pixelQueue ) - 1u - backIndex;

					}

					pixelIndex = pixelQueue[ queueIndex ];
					indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );

					// skip the pixel if it has hit the sample limit
					let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
					samples = ( ${ SAMPLE_COUNT_MASK }u & combinedField );
					if ( maxSamples != 0u && samples >= maxSamples ) {

						continue;

					}

					${ rngInit }( globalSeed, indexUV, samples, 0 );

					if ( ${ getCameraRayFn }( indexUV, ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ), vec2f( targetDimensions ), &ray ) ) {

						hasPixel = true;
						break;

					}

					// the camera declined the pixel. With a sample cap the pixel counts as finished, since it
					// will never take a sample
					// TODO: mark declined pixels with their own flag rather than a fake sample count, and let the
					// camera say whether a pixel is declined for good or only for this sample
					if ( maxSamples != 0u ) {

						textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ( combinedField & ~${ SAMPLE_COUNT_MASK }u ) | maxSamples ) );

					}

				}

				// nothing to sample this round, so the slot stays idle
				if ( ! hasPixel ) {

					rayDataStorage[ index ].pixelIndex = ${ NO_PIXEL }u;
					rayDataStorage[ index ].rayIntersectionIndex = - 1;
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
					return;

				}

				ray.direction = normalize( ray.direction );

				rayDataStorage[ index ].origin = ray.origin;
				rayDataStorage[ index ].direction = ray.direction;
				rayDataStorage[ index ].pixelIndex = pixelIndex;
				rayDataStorage[ index ].sampleIndex = samples;
				rayDataStorage[ index ].hit.bounce = 0u;
				rayDataStorage[ index ].throughputColor = vec3f( 1.0 );
				rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
				rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
				rayDataStorage[ index ].scatterPdf = 1.0;
				rayDataStorage[ index ].minPdf = 1.0;
				rayDataStorage[ index ].isFullyTransmissive = 1u;
				rayDataStorage[ index ].emission = vec3f( 0.0 );
				rayDataStorage[ index ].lightPdf = 0.0;
				rayDataStorage[ index ].alphaDepth = 0u;
				rayDataStorage[ index ].rayStart = 0.0;
				rayDataStorage[ index ].maxDist = ray.maxDist;
				rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
				rayDataStorage[ index ].dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );
				rayDataStorage[ index ].auxAlbedo = 0u;
				rayDataStorage[ index ].auxNormal = 0u;
				rayDataStorage[ index ].subsurfaceBounces = 0u;
				rayDataStorage[ index ].fogBounces = 0u;
				rayDataStorage[ index ].walkPending = 0u;
				rayDataStorage[ index ].mediumScattered = 0u;
				rayDataStorage[ index ].fogScatter = 0u;
				rayDataStorage[ index ].cameraHitLight = 0u;

				// marks the slot as spawned this round. CameraMediumKernel replaces it with the ray's queue index
				rayDataStorage[ index ].rayIntersectionIndex = 0;

				// write the active params & dispatched flag
				let convergedFlag = textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_CONVERGED_FLAG }u;
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_ACTIVE_FLAG }u | ${ SAMPLE_DISPATCHED_FLAG }u | convergedFlag | samples ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
