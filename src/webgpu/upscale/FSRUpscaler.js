import { Vector2 } from 'three/webgpu';
/** @import { Camera, Texture, WebGPURenderer } from 'three/webgpu' */

const _size = /*@__PURE__*/ new Vector2();

/**
 * Upscales a path traced image to the drawing buffer size with FSR. Pass one to
 * "WebGPUPathTracer.setUpscaler".
 *
 * The "Upscaler" class is passed in rather than imported so it does not become a dependency.
 *
 * ```js
 * import { Upscaler } from '@pmndrs/upscaler';
 * pathTracer.setUpscaler( new FSRUpscaler( { Upscaler } ) );
 * ```
 */
export class FSRUpscaler {

	/**
	 * Every field below can also be assigned after construction.
	 *
	 * @param {Object} options
	 * @param {Function} options.Upscaler - The `Upscaler` class from `@pmndrs/upscaler`.
	 * @param {number} [options.sharpness]
	 */
	constructor( options = {} ) {

		const { Upscaler, sharpness = 1 } = options;

		if ( ! Upscaler ) {

			throw new Error( 'FSRUpscaler: the "Upscaler" class from "@pmndrs/upscaler" must be provided.' );

		}

		this.Upscaler = Upscaler;

		// edge sharpening applied after the upscale, in [0,1]
		this.sharpness = sharpness;

		this.renderer = null;

		this._upscaler = null;

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	init( renderer ) {

		this.renderer = renderer;
		this._upscaler = new this.Upscaler( { renderer } );
		this._upscaler.init();

	}

	/**
	 * Upscales a texture to the renderer's drawing buffer size.
	 *
	 * @param {Texture} source
	 * @param {Camera} camera
	 * @returns {Texture}
	 */
	upscale( source, camera ) {

		const { renderer, _upscaler: upscaler } = this;

		// the upscaler reads the raw GPUTexture, which only exists once three has initialized it
		renderer.initTexture( source );

		renderer.getDrawingBufferSize( _size );

		// "configure" reallocates the working textures, so only call it when something moved
		const changed =
			upscaler.displayWidth !== _size.x ||
			upscaler.displayHeight !== _size.y ||
			upscaler.renderWidth !== source.width ||
			upscaler.renderHeight !== source.height;

		if ( changed ) {

			upscaler.configure( {
				displayWidth: _size.x,
				displayHeight: _size.y,
				renderWidth: source.width,
				renderHeight: source.height,

				// the temporal paths need motion vectors the path tracer does not produce
				path: 'spatial',
			} );

		}

		upscaler.settings.sharpness = this.sharpness;
		upscaler.dispatch( { color: source }, camera );
		return upscaler.outputTexture;

	}

	dispose() {

		this._upscaler.dispose();
		this._upscaler = null;

	}

}
