import { ExternalTexture } from 'three/webgpu';
import { UNPACK_AUX_ALBEDO_WGSL, UNPACK_AUX_NORMAL_WGSL, AUX_LAYERS } from '../nodes/aux.wgsl.js';

/** @import { StorageArrayTexture, Texture, WebGPURenderer } from 'three/webgpu' */
/** @import { DynamicTileSetting } from 'oidn-webgpu' */

/**
 * Runs Open Image Denoise over a path traced image. Pass one to
 * "WebGPUPathTracer.setDenoiser", or drive it directly with "denoise".
 *
 * "initUNetFromURL" and the weights are passed in rather than imported so neither the library
 * nor the network files become a dependency.
 *
 * ```js
 * import { initUNetFromURL } from 'oidn-webgpu';
 * pathTracer.setDenoiser( new OIDNDenoiser( { initUNetFromURL, auxWeightsUrl } ) );
 * ```
 *
 * Weights come from the oidn-weights repository, where the "_small" and "_large" variants trade
 * quality against download size and per tile cost.
 */
export class OIDNDenoiser {

	/**
	 * The denoised result, or null until the first tile has been produced.
	 *
	 * @type {ExternalTexture|null}
	 */
	get texture() {

		return this._texture;

	}

	/**
	 * Whether a pass has finished. Stays true until reset.
	 *
	 * @type {boolean}
	 */
	get complete() {

		return this._complete;

	}

	/**
	 * Whether a pass is running. The work is spread over several frames.
	 *
	 * @type {boolean}
	 */
	get running() {

		return this._running;

	}

	/**
	 * Every field below can also be assigned after construction.
	 *
	 * @param {Object} options
	 * @param {Function} options.initUNetFromURL
	 * @param {string} options.auxWeightsUrl - Weights for the guided model.
	 * @param {string} [options.colorWeightsUrl] - Weights for the color only model, needed only
	 * when `useAuxiliaryBuffers` is `false`.
	 * @param {boolean} [options.useAuxiliaryBuffers]
	 * @param {number|null} [options.maxTileSize]
	 * @param {DynamicTileSetting|null} [options.dynamicTile] - `false` pins every tile to
	 * `maxTileSize`. An object tunes the adaptive sizing.
	 */
	constructor( options = {} ) {

		const {
			initUNetFromURL,
			auxWeightsUrl,
			colorWeightsUrl,
			useAuxiliaryBuffers = true,
			maxTileSize = null,
			dynamicTile = null,
		} = options;

		if ( ! initUNetFromURL ) {

			throw new Error( 'OIDNDenoiser: "initUNetFromURL" from "oidn-webgpu" must be provided.' );

		}

		this.initUNetFromURL = initUNetFromURL;
		this.auxWeightsUrl = auxWeightsUrl;
		this.colorWeightsUrl = colorWeightsUrl;

		// `false` falls back to the color only model, which is blurrier but needs no auxiliary buffers
		this.useAuxiliaryBuffers = useAuxiliaryBuffers;

		// tiling, passed through to oidn-webgpu. Null keeps its defaults
		this.maxTileSize = maxTileSize;
		this.dynamicTile = dynamicTile;

		this.renderer = null;

		this._texture = null;
		this._running = false;
		this._complete = false;
		this._abort = null;
		this._requestId = 0;
		this._unets = { aux: null, color: null };

		this._resultPipelines = {};
		this._rawTexture = null;
		this._alphaTexture = null;

		this._unpackPipeline = null;
		this._auxTextures = null;

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	init( renderer ) {

		this.renderer = renderer;

	}

	/**
	 * Starts a pass guided by the first hit albedo and normal the path tracer accumulates, unless
	 * `useAuxiliaryBuffers` is off. Safe to call every frame.
	 *
	 * @param {Texture} color - The path traced result, in linear HDR.
	 * @param {StorageArrayTexture|null} aux - The packed auxiliary images, see "aux.wgsl.js".
	 * @param {boolean} [denoiseAlpha] - Also denoises the alpha, in a second network pass.
	 * @returns {Texture|null}
	 */
	update( color, aux = null, denoiseAlpha = false ) {

		if ( this._complete || this._running ) {

			return this._texture;

		}

		if ( this.useAuxiliaryBuffers && aux ) {

			// oidn-webgpu reads every input as the same kind, so the auxiliary images are unpacked into
			// textures alongside the color
			const { albedo, normal } = this._unpackAux( aux );
			this._denoise( color, albedo, normal, denoiseAlpha );

		} else {

			this._denoise( color, null, null, denoiseAlpha );

		}

		return this._texture;

	}

	/**
	 * Runs a pass unless one is already running or finished. The optional albedo and normal
	 * textures select the guided model. Both hold [0,1] values in the color's row order, with
	 * normals mapped so a flat normal is (0.5, 0.5, 1).
	 *
	 * @param {Texture} color - The path traced result, in linear HDR.
	 * @param {Texture|null} albedo
	 * @param {Texture|null} normal
	 * @param {boolean} [denoiseAlpha] - Also denoises the alpha, in a second network pass.
	 */
	async denoise( color, albedo = null, normal = null, denoiseAlpha = false ) {

		return this._denoise( color, albedo, normal, denoiseAlpha );

	}

	// the inputs are three textures, or raw gpu textures
	async _denoise( color, albedo, normal, denoiseAlpha ) {

		if ( this._complete || this._running ) {

			return;

		}

		this._running = true;

		const useAux = Boolean( albedo && normal );
		const requestId = ++ this._requestId;

		let unet;
		try {

			unet = await this._initUNet( useAux );

		} catch ( error ) {

			// leaving "running" set would stall every later pass
			this._running = false;
			throw error;

		}

		// bail if a reset or a newer call took over while the weights downloaded
		if ( requestId !== this._requestId || ! this._running ) {

			return;

		}

		// three only holds a WebGPU texture for a three texture once it has been initialized
		const { renderer } = this;
		const getTexture = value => {

			if ( value instanceof GPUTexture ) {

				return value;

			}

			renderer.initTexture( value );
			return renderer.backend.get( value ).texture;

		};

		const { width, height } = color;
		const inputs = {
			color: { data: getTexture( color ), width, height },

			// pace the tiles to display frames so the path tracer keeps rendering between them
			scheduling: 'animation-frame',
		};

		// the guided model needs both auxiliary images, and the color only model must not be given them
		if ( useAux ) {

			inputs.albedo = { data: getTexture( albedo ), width, height };
			inputs.normal = { data: getTexture( normal ), width, height };

		}

		// A pass denoises either the color or the alpha and passes the other through, so the alpha
		// runs first and the color pass takes its alpha from the result
		// TODO: this doesn't work yet. oidn-webgpu's "_updatePasses" only rebuilds its shaders when the
		// input kind changes, not "denoiseAlpha", so both passes run whichever shaders were built first.
		// Needs a fix upstream, or a separate network instance for the alpha pass
		if ( denoiseAlpha ) {

			const output = await this._execute( unet, { ...inputs, denoiseAlpha: true } );
			if ( requestId !== this._requestId || ! this._running ) {

				return;

			}

			this._copyAlphaToTexture( output, width, height );

		}

		// the output is seeded with the raw color, so copying per tile shows a progressive wipe
		const progress = output => this._copyOutputToTexture( output, width, height, denoiseAlpha );
		await this._execute( unet, inputs, progress );

		this._running = false;
		this._complete = true;
		this._abort = null;
		this._disposeInputs();

	}

	// Runs the network over every tile, resolving with the output once the last one is done. An aborted
	// pass never resolves
	_execute( unet, inputs, progress = null ) {

		return new Promise( resolve => {

			this._abort = unet.tileExecute( {
				...inputs,
				progress: progress ?? ( () => {} ),
				done: resolve,
			} );

		} );

	}

	/**
	 * Drops any running pass and the last result. Call it whenever the image changes, such as when
	 * the camera moves.
	 */
	reset() {

		this._abort?.();
		this._abort = null;

		this._texture?.dispose();
		this._texture = null;

		this._rawTexture?.destroy();
		this._rawTexture = null;

		this._disposeInputs();

		this._running = false;
		this._complete = false;

	}

	dispose() {

		this.reset();

		// the networks hold the weights on the GPU, and a load may still be in flight
		for ( const key in this._unets ) {

			this._unets[ key ]?.then( unet => unet.dispose() );
			this._unets[ key ] = null;

		}

	}

	// Unpacks the path tracer's packed auxiliary images into albedo and normal textures, the input kind
	// oidn-webgpu reads alongside the color texture
	_unpackAux( aux ) {

		const { renderer } = this;
		const backend = renderer.backend;
		const device = backend.device;
		const { width, height } = aux.image;

		if ( ! this._unpackPipeline ) {

			const module = device.createShaderModule( {
				code: /* wgsl */`
					@group( 0 ) @binding( 0 ) var aux : texture_2d_array<u32>;
					@group( 0 ) @binding( 1 ) var outAlbedo : texture_storage_2d<rgba16float, write>;
					@group( 0 ) @binding( 2 ) var outNormal : texture_storage_2d<rgba16float, write>;

					${ UNPACK_AUX_ALBEDO_WGSL }
					${ UNPACK_AUX_NORMAL_WGSL }

					@compute @workgroup_size( 8, 8 )
					fn main( @builtin( global_invocation_id ) gid : vec3u ) {

						let dims = textureDimensions( aux );
						if ( gid.x >= dims.x || gid.y >= dims.y ) {

							return;

						}

						var packed: vec3u;
						for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

							packed[ layer ] = textureLoad( aux, gid.xy, layer, 0 ).r;

						}

						textureStore( outAlbedo, gid.xy, vec4f( unpackAuxAlbedo( packed ), 1.0 ) );
						textureStore( outNormal, gid.xy, vec4f( unpackAuxNormal( packed ), 1.0 ) );

					}
				`,
			} );

			this._unpackPipeline = device.createComputePipeline( {
				layout: 'auto',
				compute: { module, entryPoint: 'main' },
			} );

		}

		let textures = this._auxTextures;
		if ( ! textures || textures.width !== width || textures.height !== height ) {

			this._disposeInputs();

			const createTexture = () => device.createTexture( {
				size: [ width, height ],
				format: 'rgba16float',
				usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
			} );
			textures = { width, height, albedo: createTexture(), normal: createTexture() };
			this._auxTextures = textures;

		}

		const bindGroup = device.createBindGroup( {
			layout: this._unpackPipeline.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 0, resource: backend.get( aux ).texture.createView( { dimension: '2d-array' } ) },
				{ binding: 1, resource: textures.albedo.createView() },
				{ binding: 2, resource: textures.normal.createView() },
			],
		} );

		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline( this._unpackPipeline );
		pass.setBindGroup( 0, bindGroup );
		pass.dispatchWorkgroups( Math.ceil( width / 8 ), Math.ceil( height / 8 ) );
		pass.end();
		device.queue.submit( [ encoder.finish() ] );

		return textures;

	}

	// Frees the unpacked auxiliary images and the denoised alpha, which only live for a pass
	_disposeInputs() {

		const textures = this._auxTextures;
		if ( textures ) {

			textures.albedo.destroy();
			textures.normal.destroy();
			this._auxTextures = null;

		}

		this._alphaTexture?.destroy();
		this._alphaTexture = null;

	}

	// loads each model once, with concurrent calls sharing the same promise
	_initUNet( aux ) {

		const key = aux ? 'aux' : 'color';
		if ( ! this._unets[ key ] ) {

			this._unets[ key ] = ( async () => {

				const device = this.renderer.backend.device;
				const url = aux ? this.auxWeightsUrl : this.colorWeightsUrl;

				if ( ! url ) {

					throw new Error( `OIDNDenoiser: no ${ aux ? 'auxWeightsUrl' : 'colorWeightsUrl' } was provided.` );

				}

				const options = { aux, hdr: true };
				if ( this.maxTileSize !== null ) options.maxTileSize = this.maxTileSize;
				if ( this.dynamicTile !== null ) options.dynamicTile = this.dynamicTile;

				return this.initUNetFromURL( url, { device }, options );

			} )();

		}

		return this._unets[ key ];

	}

	// Copies the denoiser's packed output buffer into a sampleable texture, using a compute pass
	// since copyBufferToTexture requires 256 byte row alignment. With "useAlpha" the alpha comes from
	// the alpha pass instead.
	// TODO: remove the copy once oidn-webgpu can write into a caller-provided storage texture.
	_copyOutputToTexture( output, width, height, useAlpha ) {

		const device = this.renderer.backend.device;

		if ( ! this._rawTexture || this._rawTexture.width !== width || this._rawTexture.height !== height ) {

			this._rawTexture?.destroy();
			this._rawTexture = device.createTexture( {
				size: [ width, height ],
				format: 'rgba16float',
				usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
			} );

			// ExternalTexture lets three sample a gpu texture it did not create. It has no image
			// behind it, so its size is set explicitly or "texture.width" reports zero.
			this._texture?.dispose();
			this._texture = new ExternalTexture( this._rawTexture );
			this._texture.image = { width, height };

		}

		const entries = [
			{ binding: 0, resource: { buffer: output.data } },
			{ binding: 1, resource: this._rawTexture.createView() },
		];

		if ( useAlpha ) {

			entries.push( { binding: 2, resource: this._alphaTexture.createView() } );
			this._runCopyPass( 'colorWithAlpha', /* wgsl */`
				@group( 0 ) @binding( 2 ) var alpha : texture_2d<f32>;
			`, /* wgsl */`
				vec4f( src[ i ].rgb, textureLoad( alpha, gid.xy, 0 ).a )
			`, entries, width, height );

		} else {

			this._runCopyPass( 'color', '', 'src[ i ]', entries, width, height );

		}

	}

	// Keeps the alpha pass's denoised alpha for the color pass that follows, since both passes write the
	// same output buffer
	_copyAlphaToTexture( output, width, height ) {

		const device = this.renderer.backend.device;

		if ( ! this._alphaTexture || this._alphaTexture.width !== width || this._alphaTexture.height !== height ) {

			this._alphaTexture?.destroy();
			this._alphaTexture = device.createTexture( {
				size: [ width, height ],
				format: 'rgba16float',
				usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
			} );

		}

		const entries = [
			{ binding: 0, resource: { buffer: output.data } },
			{ binding: 1, resource: this._alphaTexture.createView() },
		];

		this._runCopyPass( 'alpha', '', 'vec4f( src[ i ].a )', entries, width, height );

	}

	// Writes "value", an expression of the output buffer "src" at index "i", into the "dst" texture
	_runCopyPass( key, bindings, value, entries, width, height ) {

		const device = this.renderer.backend.device;

		if ( ! this._resultPipelines[ key ] ) {

			const module = device.createShaderModule( {
				code: /* wgsl */`
					@group( 0 ) @binding( 0 ) var<storage, read> src : array<vec4f>;
					@group( 0 ) @binding( 1 ) var dst : texture_storage_2d<rgba16float, write>;
					${ bindings }

					@compute @workgroup_size( 8, 8 )
					fn main( @builtin( global_invocation_id ) gid : vec3u ) {

						let dims = textureDimensions( dst );
						if ( gid.x >= dims.x || gid.y >= dims.y ) {

							return;

						}

						let i = gid.y * dims.x + gid.x;
						textureStore( dst, gid.xy, ${ value } );

					}
				`,
			} );

			this._resultPipelines[ key ] = device.createComputePipeline( {
				layout: 'auto',
				compute: { module, entryPoint: 'main' },
			} );

		}

		const pipeline = this._resultPipelines[ key ];
		const bindGroup = device.createBindGroup( {
			layout: pipeline.getBindGroupLayout( 0 ),
			entries,
		} );

		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline( pipeline );
		pass.setBindGroup( 0, bindGroup );
		pass.dispatchWorkgroups( Math.ceil( width / 8 ), Math.ceil( height / 8 ) );
		pass.end();
		device.queue.submit( [ encoder.finish() ] );

	}

}
