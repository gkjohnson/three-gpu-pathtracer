/** @import { Object3D, Scene, Texture, WebGPURenderer } from 'three/webgpu' */
import { texture } from 'three/tsl';
import { WebGPUPathTracer } from '../WebGPUPathTracer.js';
import { GutterFiller } from '../lib/GutterFiller.js';
import { ZeroOutKernel } from '../compute/ZeroOutKernel.js';
import { LightmapCamera } from './LightmapCamera.js';
import { LightmapShadingModel } from './LightmapShadingModel.js';

/**
 * Irradiance cached over a lightmap atlas at a lower resolution, for "LightmapShadingModel" to end its
 * paths with: a bake with a cache gathers the light the surfaces around each texel reflect from the cache
 * rather than tracing the bounces, so it converges much faster, to an approximation limited by the cache's
 * resolution and noise rather than to the path traced result.
 *
 * The cache is solved by baking it with its own path tracer, which ends its paths in the iterate before:
 * every iteration adds a bounce of light, and the last one takes more samples to settle the noise. The
 * gutters around the charts are filled after each, so the cache can be filtered at chart edges.
 *
 * ```js
 * const cache = new LightmapCache( renderer );
 * cache.update( scene, model );
 *
 * pathTracer.setShadingModel( new LightmapShadingModel( { cache } ) );
 * pathTracer.setScene( scene, new LightmapCamera( model ) );
 * ```
 */
export class LightmapCache {

	/**
	 * @param {WebGPURenderer} renderer
	 * @param {Object} [options]
	 * @param {number} [options.resolution=256] - Width and height of the cache in texels.
	 * @param {number} [options.bounces=16] - Iterations that each add a bounce of light.
	 * @param {number} [options.samples=4] - Samples per texel of each iteration.
	 * @param {number} [options.finalSamples=32] - Samples per texel of the last iteration.
	 */
	constructor( renderer, options = {} ) {

		const {
			resolution = 256,
			bounces = 16,
			samples = 4,
			finalSamples = 32,
		} = options;

		this.renderer = renderer;
		this.resolution = resolution;
		this.bounces = bounces;
		this.samples = samples;
		this.finalSamples = finalSamples;

		// the shading models sample one texture, and each iterate is copied into it once its gutters are filled.
		// The kernels keep the texture they were built with, so it isn't swapped
		this._gutterFiller = new GutterFiller( renderer, resolution );
		this._filled = this._gutterFiller.createTarget();
		this.textureNode = texture( this._gutterFiller.createTarget() );
		this._clearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );

	}

	/**
	 * The cached irradiance, in the space of the atlas' "uv1".
	 * @type {Texture}
	 */
	get texture() {

		return this.textureNode.value;

	}

	/**
	 * Solves the cache for the scene, baking the meshes under the root. Call again after the scene or its
	 * lighting change.
	 *
	 * @param {Scene} scene - The scene, lit as the bake will be.
	 * @param {Object3D} root - A mesh or hierarchy whose meshes share the "uv1" atlas, as for "LightmapCamera".
	 */
	update( scene, root ) {

		const { renderer, resolution, bounces, samples, finalSamples } = this;

		// the size changed since the targets were made
		if ( this._gutterFiller.size !== resolution ) {

			this._resize();

		}

		const { _gutterFiller, _filled } = this;
		const cacheTexture = this.textureNode.value;

		// no bounced light to start with
		this._clearKernel.target = cacheTexture;
		renderer.compute( this._clearKernel.kernel, this._clearKernel.getDispatchSize( resolution, resolution ) );

		// The cache is baked by a path tracer of its own, ending its paths in the latest iterate
		const pathTracer = new WebGPUPathTracer( renderer );
		pathTracer.synchronizeRenderSize = false;
		pathTracer.renderToCanvas = false;
		pathTracer.dynamicLowRes = false;
		pathTracer.renderDelay = 0;
		pathTracer.minSamples = 0;
		pathTracer.adaptiveFrameBudget = false;
		pathTracer.setShadingModel( new LightmapShadingModel( { cache: this } ) );

		const camera = new LightmapCamera( root );
		pathTracer.setScene( scene, camera );
		pathTracer.setSize( resolution, resolution );

		// every texel keeps a path slot, and each step of the paths takes one iteration. A sample traces the
		// texel, then the ray that ends in the cache, and is resolved in the iteration that starts the next
		// one, so every texel finishes its samples within three iterations per sample without a readback of
		// the counts. Each call runs three iterations
		pathTracer.frameBudget = 3 * resolution * resolution;

		for ( let i = 0; i <= bounces; i ++ ) {

			const count = i < bounces ? samples : finalSamples;
			pathTracer.reset();
			pathTracer.maxSamples = count;
			for ( let s = 0; s < count + 2; s ++ ) {

				pathTracer.renderSample();

			}

			_gutterFiller.fill( pathTracer.target, camera.idTexture.texture, _filled );
			renderer.copyTextureToTexture( _filled, cacheTexture );

		}

		pathTracer.dispose();
		camera.dispose();

	}

	_resize() {

		// the texture keeps its object so the kernels built with it keep sampling it
		const { resolution } = this;
		this._gutterFiller.dispose();
		this._filled.dispose();
		this._gutterFiller = new GutterFiller( this.renderer, resolution );
		this._filled = this._gutterFiller.createTarget();
		this.textureNode.value.setSize( resolution, resolution );

	}

	dispose() {

		this._gutterFiller.dispose();
		this._filled.dispose();
		this.textureNode.value.dispose();
		this._clearKernel.dispose();

	}

}
