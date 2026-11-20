/** @import { Camera, Texture, WebGPURenderer } from 'three/webgpu' */

/**
 * Upscales a path traced image with FSR, to the drawing buffer size when presented. Pass one to
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
	 * The last upscaled result, or null until the first upscale.
	 *
	 * @type {Texture|null}
	 */
	get texture() {

		return this._texture;

	}

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
		this._texture = null;

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	init( renderer ) {

		this.renderer = renderer;
		this._upscaler?.dispose();
		this._upscaler = new this.Upscaler( { renderer } );
		this._upscaler.init();

	}

	/**
	 * Upscales a texture to the given size.
	 *
	 * @param {Texture} source
	 * @param {Camera} camera
	 * @param {number} width
	 * @param {number} height
	 * @returns {Texture}
	 */
	upscale( source, camera, width, height ) {

		const { renderer, _upscaler: upscaler } = this;

		// the upscaler reads the raw GPUTexture, which only exists once three has initialized it
		renderer.initTexture( source );

		// "configure" reallocates the working textures, so only call it when something moved
		const changed =
			upscaler.displayWidth !== width ||
			upscaler.displayHeight !== height ||
			upscaler.renderWidth !== source.width ||
			upscaler.renderHeight !== source.height;

		if ( changed ) {

			upscaler.configure( {
				displayWidth: width,
				displayHeight: height,
				renderWidth: source.width,
				renderHeight: source.height,

				// the temporal paths need motion vectors the path tracer does not produce
				path: 'spatial',
			} );

		}

		upscaler.settings.sharpness = this.sharpness;
		upscaler.dispatch( { color: source }, camera );
		this._texture = upscaler.outputTexture;
		return this._texture;

	}

	dispose() {

		this._upscaler?.dispose();
		this._upscaler = null;
		this._texture = null;

	}

}
