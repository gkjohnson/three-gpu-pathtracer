import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { ComputeKernel } from '../ComputeKernel.js';
import { createOutputTarget, createSampleCountTarget, OUTPUT_LUMINANCE_LAYER, OUTPUT_LUMINANCE_SQUARED_LAYER } from '../targets.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { SAMPLE_ACTIVE_FLAG, SAMPLE_CONVERGED_FLAG, SAMPLE_COUNT_MASK } from '../../constants.js';
import { pixelQueueInfoStruct } from './structs.js';

// Rebuilds the pixel queue, putting the pixels with fewer samples at the front. With adaptive sampling
// enabled, pixels whose noise has dropped below the threshold are flagged as converged and left out, so
// the paths go to the pixels that still need them.
export class RebuildPixelQueueKernel extends ComputeKernel {

	constructor() {

		const params = {
			maxSamples: uniform( 0, 'uint' ),
			adaptiveThreshold: uniform( 0 ),
			adaptiveMinSamples: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			sampleCountTarget: textureStore( createSampleCountTarget() ).toReadWrite(),
			outputTarget: textureStore( createOutputTarget() ).toReadOnly(),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), 'uint' ),
			pixelQueueInfo: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueInfoStruct ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( maxSamples: u32, adaptiveThreshold: f32, adaptiveMinSamples: u32, targetDimensions: vec2u, globalId: vec3u ) -> void {

				let uv = globalId.xy;
				if ( uv.x >= targetDimensions.x || uv.y >= targetDimensions.y ) {

					return;

				}

				let combinedField = textureLoad( ${ params.sampleCountTarget }, uv ).r;
				let samples = combinedField & ${ SAMPLE_COUNT_MASK }u;
				let isActive = ( combinedField & ${ SAMPLE_ACTIVE_FLAG }u ) != 0u;
				let isConverged = ( combinedField & ${ SAMPLE_CONVERGED_FLAG }u ) != 0u;
				let isFinished = maxSamples != 0u && samples >= maxSamples;
				if ( isActive || isFinished || isConverged ) {

					return;

				}

				// A pixel converges once the noisiest pixel of its 3x3 neighborhood is below the threshold.
				// The neighborhood keeps a pixel that has not happened to see a rare bright path yet, like a
				// caustic, from stopping early
				let minSamples = max( adaptiveMinSamples, 2u );
				if ( adaptiveThreshold > 0.0 && samples >= minSamples ) {

					var isNeighborhoodConverged = true;
					for ( var y = - 1; y <= 1 && isNeighborhoodConverged; y ++ ) {

						for ( var x = - 1; x <= 1; x ++ ) {

							let neighbor = vec2i( uv ) + vec2i( x, y );
							if ( any( neighbor < vec2i( 0 ) ) || any( neighbor >= vec2i( targetDimensions ) ) ) {

								continue;

							}

							// a neighbor with too few samples can't be judged, so the pixel keeps sampling
							let neighborUV = vec2u( neighbor );
							let neighborSamples = textureLoad( ${ params.sampleCountTarget }, neighborUV ).r & ${ SAMPLE_COUNT_MASK }u;
							if ( neighborSamples < minSamples ) {

								isNeighborhoodConverged = false;
								break;

							}

							// The noise of the mean luminance is its standard error, relative to the square root of
							// the luminance so the threshold behaves perceptually, as a cheap stand-in for tone mapping.
							// The color rows are stored top down to match a rasterized render target
							let colorIndex = vec2u( neighborUV.x, targetDimensions.y - 1u - neighborUV.y );
							let mean = max( textureLoad( ${ params.outputTarget }, colorIndex, ${ OUTPUT_LUMINANCE_LAYER } ).r, 0.0 );
							let meanSquared = textureLoad( ${ params.outputTarget }, colorIndex, ${ OUTPUT_LUMINANCE_SQUARED_LAYER } ).r;
							let n = f32( neighborSamples );
							let variance = max( meanSquared - mean * mean, 0.0 ) * n / ( n - 1.0 );
							let noise = sqrt( variance / n ) / max( sqrt( mean ), 1e-2 );
							if ( ! ( noise < adaptiveThreshold ) ) {

								isNeighborhoodConverged = false;
								break;

							}

						}

					}

					if ( isNeighborhoodConverged ) {

						textureStore( ${ params.sampleCountTarget }, uv, vec4( combinedField | ${ SAMPLE_CONVERGED_FLAG }u ) );
						return;

					}

				}

				// TODO: the midpoint comes from the previous rebuild's sample range, a pass late. Measuring the range
				// before the rebuild needs another full resolution pass
				var queueIndex: u32;
				if ( samples <= atomicLoad( &${ params.pixelQueueInfo }[ 0 ].sampleCountMidpoint ) ) {

					queueIndex = atomicAdd( &${ params.pixelQueueInfo }[ 0 ].frontCount, 1u );

				} else {

					queueIndex = arrayLength( &${ params.pixelQueue } ) - 1u - atomicAdd( &${ params.pixelQueueInfo }[ 0 ].backCount, 1u );

				}

				${ params.pixelQueue }[ queueIndex ] = ( uv.x << 16 ) | uv.y;

				// checked first so most threads skip the atomics
				if ( samples < atomicLoad( &${ params.pixelQueueInfo }[ 0 ].minSamples ) ) {

					atomicMin( &${ params.pixelQueueInfo }[ 0 ].minSamples, samples );

				}

				if ( samples > atomicLoad( &${ params.pixelQueueInfo }[ 0 ].maxSamples ) ) {

					atomicMax( &${ params.pixelQueueInfo }[ 0 ].maxSamples, samples );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
