import { wgslFn } from 'three/tsl';
import { SAMPLE_CONVERGED_FLAG, SAMPLE_DISPATCHED_FLAG } from '../constants.js';

// Adaptive sampling, as in Cycles. The output target's layers after the color hold the mean of half the samples,
// doubled, and a pixel's noise is how far it is from the mean of all of them.

// the output target's layer count, without and with the half of the samples for adaptive sampling
export const OUTPUT_COLOR_LAYERS = 4;
export const OUTPUT_ADAPTIVE_LAYERS = 7;

// the samples between convergence checks, a power of two. Every aligned block of 4 samples splits evenly between the
// halves, so a check is never off balance. Cycles checks every 16 to batch its image wide passes, which a check per
// pixel doesn't need
const ADAPTIVE_STEP = 4;

// Adds a finished sample to the half of the samples and returns the pixel's converged flag, checked every
// "ADAPTIVE_STEP" samples past "minSamples". "blendedColor" is the pixel's color with the sample added.
export const accumulateAdaptiveFn = wgslFn( /* wgsl */`
	fn accumulateAdaptive(
		outputTarget: texture_storage_2d_array<r32float, read_write>,
		pixel: vec2u,
		sampleColor: vec4f,
		blendedColor: vec4f,
		sampleCount: u32,
		convergedFlag: u32,
		threshold: f32,
		minSamples: u32,
	) -> u32 {

		// only an output target with the half's layers samples adaptively
		if ( textureNumLayers( outputTarget ) < ${ OUTPUT_ADAPTIVE_LAYERS } ) {

			return convergedFlag;

		}

		// the half of the samples Cycles picks, which keeps each half well distributed in the Sobol sequence. The
		// colors are compared premultiplied, since the color is blended by its alpha
		let sampleIndex = sampleCount - 1u;
		let isHalf = ( countOneBits( sampleIndex & 0xaaaaaaaau ) & 1u ) != 0u;
		let halfSample = select( vec3f( 0.0 ), 2.0 * sampleColor.rgb * sampleColor.a, isHalf );
		let previousHalf = vec3f(
			textureLoad( outputTarget, pixel, ${ OUTPUT_COLOR_LAYERS } ).r,
			textureLoad( outputTarget, pixel, ${ OUTPUT_COLOR_LAYERS + 1 } ).r,
			textureLoad( outputTarget, pixel, ${ OUTPUT_COLOR_LAYERS + 2 } ).r,
		);

		let halfColor = previousHalf + ( halfSample - previousHalf ) / f32( sampleCount );
		textureStore( outputTarget, pixel, ${ OUTPUT_COLOR_LAYERS }, vec4f( halfColor.r ) );
		textureStore( outputTarget, pixel, ${ OUTPUT_COLOR_LAYERS + 1 }, vec4f( halfColor.g ) );
		textureStore( outputTarget, pixel, ${ OUTPUT_COLOR_LAYERS + 2 }, vec4f( halfColor.b ) );

		if ( sampleIndex <= minSamples || ( sampleIndex & ${ ADAPTIVE_STEP - 1 }u ) != ${ ADAPTIVE_STEP - 1 }u ) {

			return convergedFlag;

		}

		// Cycles' per pixel error: the difference relative to the square root of the intensity, or to the
		// intensity itself once it's bright
		let color = blendedColor.rgb * blendedColor.a;
		let difference = abs( color.r - halfColor.r ) + abs( color.g - halfColor.g ) + abs( color.b - halfColor.b );
		let intensity = color.r + color.g + color.b;
		let normalization = select( intensity, sqrt( intensity ), intensity < 1.0 );
		let error = difference / ( 0.0001 + normalization );
		return select( 0u, ${ SAMPLE_CONVERGED_FLAG }u, error < threshold );

	}
` );

// Returns whether a pixel is done sampling: it and the pixels around it have converged, so the noisy pixels'
// neighbors keep sampling as well, as Cycles' filter does
function getIsPixelConvergedFn( access ) {

	return wgslFn( /* wgsl */`
		fn isPixelConverged( sampleCountTarget: texture_storage_2d<r32uint, ${ access }>, pixel: vec2u ) -> bool {

			if ( ( textureLoad( sampleCountTarget, pixel ).r & ${ SAMPLE_CONVERGED_FLAG }u ) == 0u ) {

				return false;

			}

			let dimensions = vec2i( textureDimensions( sampleCountTarget ) );
			for ( var y = - 1; y <= 1; y ++ ) {

				for ( var x = - 1; x <= 1; x ++ ) {

					let neighbor = vec2i( pixel ) + vec2i( x, y );
					if ( any( neighbor < vec2i( 0 ) ) || any( neighbor >= dimensions ) ) {

						continue;

					}

					// pixels that never take a sample, such as ones the camera declines, don't hold their neighbors back
					let field = textureLoad( sampleCountTarget, vec2u( neighbor ) ).r;
					if ( ( field & ${ SAMPLE_DISPATCHED_FLAG }u ) != 0u && ( field & ${ SAMPLE_CONVERGED_FLAG }u ) == 0u ) {

						return false;

					}

				}

			}

			return true;

		}
	` );

}

export const isPixelConvergedFn = getIsPixelConvergedFn( 'read' );
export const isPixelConvergedReadWriteFn = getIsPixelConvergedFn( 'read_write' );

// The kernels' threshold and minimum samples, as Cycles derives them: the threshold is scaled to match the ones
// it used to take, and a "minSamples" of 0 is picked from the threshold. A threshold of 0 never converges.
export function getAdaptiveSettings( threshold, minSamples ) {

	const automaticMinSamples = threshold > 0 ? Math.ceil( 16 / Math.pow( threshold, 0.3 ) ) : 0;
	return {
		threshold: threshold * 5,
		minSamples: Math.max( 4, minSamples === 0 ? automaticMinSamples : minSamples ),
	};

}
