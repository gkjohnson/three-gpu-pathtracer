import { Vector2 } from 'three/webgpu';

const _size = /*@__PURE__*/ new Vector2();

// the full render and the low res preview it fades from
const MAX_INSTANCES = 2;

/**
 * Upscales a path traced image to the drawing buffer size with FSR. Pass one to
 * "WebGPUPathTracer.setUpscaler".
 *
 * The "Upscaler" class is passed in rather than imported so it does not become a dependency.
 *
 *     import { Upscaler } from '@pmndrs/upscaler';
 *     pathTracer.setUpscaler( new FSRUpscaler( { Upscaler } ) );
 */
export class FSRUpscaler {

	/**
	 * Every field below can also be assigned after construction.
	 *
	 * @param {Object} options
	 * @param {Function} options.Upscaler
	 * @param {number} [options.sharpness]
	 * @param {string} [options.path]
	 */
	constructor( options = {} ) {

		const { Upscaler, sharpness = 1, path = 'spatial' } = options;

		if ( ! Upscaler ) {

			throw new Error( 'FSRUpscaler: the "Upscaler" class from "@pmndrs/upscaler" must be provided.' );

		}

		this.Upscaler = Upscaler;

		// edge sharpening applied after the upscale, in [0,1]
		this.sharpness = sharpness;

		// the temporal paths need motion vectors the path tracer does not produce
		this.path = path;

		this.renderer = null;

		this._instances = new Map();

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	init( renderer ) {

		this.renderer = renderer;

	}

	/**
	 * Upscales a texture to the renderer's drawing buffer size.
	 *
	 * @param {Texture} source
	 * @param {Camera} camera
	 * @returns {Texture}
	 */
	upscale( source, camera ) {

		const { renderer } = this;

		// the upscaler reads the raw GPUTexture, which only exists once three has initialized it
		renderer.initTexture( source );

		const renderWidth = source.width;
		const renderHeight = source.height;
		if ( ! renderWidth || ! renderHeight ) {

			return source;

		}

		renderer.getDrawingBufferSize( _size );
		const displayWidth = Math.max( 1, Math.round( _size.x ) );
		const displayHeight = Math.max( 1, Math.round( _size.y ) );

		const upscaler = this._getInstance( renderWidth, renderHeight );

		const matches =
			upscaler.displayWidth === displayWidth &&
			upscaler.displayHeight === displayHeight &&
			upscaler.renderWidth === renderWidth &&
			upscaler.renderHeight === renderHeight;

		if ( ! matches ) {

			upscaler.configure( {
				displayWidth,
				displayHeight,
				renderWidth,
				renderHeight,
				path: this.path,
			} );

		}

		upscaler.settings.sharpness = this.sharpness;
		upscaler.dispatch( { color: source }, camera );
		return upscaler.outputTexture;

	}

	dispose() {

		this._instances.forEach( upscaler => upscaler.dispose() );
		this._instances.clear();

	}

	// Each source resolution keeps its own upscaler rather than reconfiguring one back and forth
	// every frame. They hold GPU timer query sets, so the pool is bounded and evicts least
	// recently used: changing the render scale would otherwise leak one per step.
	_getInstance( width, height ) {

		const key = `${ width }x${ height }`;
		const instances = this._instances;
		let upscaler = instances.get( key );

		if ( upscaler ) {

			// reinsert so map order stays least to most recently used
			instances.delete( key );

		} else {

			upscaler = new this.Upscaler( { renderer: this.renderer } );
			upscaler.init();

		}

		instances.set( key, upscaler );

		while ( instances.size > MAX_INSTANCES ) {

			const oldest = instances.keys().next().value;
			instances.get( oldest ).dispose();
			instances.delete( oldest );

		}

		return upscaler;

	}

}
