import { ExternalTexture } from 'three/webgpu';

/** @import { StorageBufferAttribute, Texture, WebGPURenderer } from 'three/webgpu' */
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

		this._resultPipeline = null;
		this._rawTexture = null;

		this._resolvePipeline = null;
		this._inputBuffers = null;

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	init( renderer ) {

		this.renderer = renderer;

	}

	/**
	 * Starts a pass guided by the first hit albedo and normal the path tracer accumulates, two
	 * vec4 per pixel, unless `useAuxiliaryBuffers` is off. Safe to call every frame.
	 *
	 * @param {Texture} color - The path traced result, in linear HDR.
	 * @param {StorageBufferAttribute|null} aux
	 * @returns {Texture|null}
	 */
	update( color, aux = null ) {

		if ( this._complete || this._running ) {

			return this._texture;

		}

		if ( this.useAuxiliaryBuffers && aux ) {

			// oidn-webgpu reads every input the same way, so the color joins the auxiliary buffers as one
			const { width, height } = color;
			const buffers = this._resolveInputs( color, aux );
			this._denoise( buffers.color, buffers.albedo, buffers.normal, width, height );

		} else {

			this.denoise( color );

		}

		return this._texture;

	}

	/**
	 * Runs a pass unless one is already running or finished. The optional albedo and normal
	 * auxiliary buffers select the guided model. Both hold one vec4 of [0,1] values per pixel in
	 * the color's row order, with normals mapped so a flat normal is (0.5, 0.5, 1).
	 *
	 * @param {Texture} color - The path traced result, in linear HDR.
	 * @param {Texture|StorageBufferAttribute|null} albedo
	 * @param {Texture|StorageBufferAttribute|null} normal
	 */
	async denoise( color, albedo = null, normal = null ) {

		const { width, height } = color;
		return this._denoise( color, albedo, normal, width, height );

	}

	// the inputs are three textures, storage attributes, or raw gpu buffers and textures
	async _denoise( color, albedo, normal, width, height ) {

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

		// three only holds a WebGPU texture for a three texture once it has been initialized. The
		// auxiliary buffers have been bound by the kernels that filled them
		const { renderer } = this;
		const backend = renderer.backend;
		const getResource = value => {

			if ( value instanceof GPUBuffer || value instanceof GPUTexture ) {

				return value;

			}

			if ( value.isTexture ) {

				renderer.initTexture( value );
				return backend.get( value ).texture;

			}

			return backend.get( value ).buffer;

		};

		const inputs = {
			color: { data: getResource( color ), width, height },

			// pace the tiles to display frames so the path tracer keeps rendering between them
			scheduling: 'animation-frame',

			// the output is seeded with the raw color, so copying per tile shows a progressive wipe
			progress: output => this._copyOutputToTexture( output, width, height ),
			done: output => {

				this._running = false;
				this._complete = true;
				this._abort = null;

			},
		};

		// the guided model needs both auxiliary buffers, and the color only model must not be given them
		if ( useAux ) {

			inputs.albedo = { data: getResource( albedo ), width, height };
			inputs.normal = { data: getResource( normal ), width, height };

		}

		this._abort = unet.tileExecute( inputs );

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

		this._running = false;
		this._complete = false;

	}

	dispose() {

		this.reset();
		this._disposeInputBuffers();

		// the networks hold the weights on the GPU, and a load may still be in flight
		for ( const key in this._unets ) {

			this._unets[ key ]?.then( unet => unet.dispose() );
			this._unets[ key ] = null;

		}

	}

	// Writes the color, albedo, and normal into buffers oidn-webgpu reads directly, since it takes
	// every input as the same kind and the kernels keep the auxiliary buffers interleaved in one
	_resolveInputs( color, aux ) {

		const { renderer } = this;
		const backend = renderer.backend;
		const device = backend.device;
		const { width, height } = color;

		if ( ! this._resolvePipeline ) {

			const module = device.createShaderModule( {
				code: /* wgsl */`
					@group( 0 ) @binding( 0 ) var color : texture_2d<f32>;
					@group( 0 ) @binding( 1 ) var<storage, read> aux : array<vec4f>;
					@group( 0 ) @binding( 2 ) var<storage, read_write> outColor : array<vec4f>;
					@group( 0 ) @binding( 3 ) var<storage, read_write> outAlbedo : array<vec4f>;
					@group( 0 ) @binding( 4 ) var<storage, read_write> outNormal : array<vec4f>;

					@compute @workgroup_size( 8, 8 )
					fn main( @builtin( global_invocation_id ) gid : vec3u ) {

						let dims = textureDimensions( color );
						if ( gid.x >= dims.x || gid.y >= dims.y ) {

							return;

						}

						let i = gid.y * dims.x + gid.x;
						outColor[ i ] = textureLoad( color, gid.xy, 0 );
						outAlbedo[ i ] = aux[ 2u * i ];
						outNormal[ i ] = aux[ 2u * i + 1u ];

					}
				`,
			} );

			this._resolvePipeline = device.createComputePipeline( {
				layout: 'auto',
				compute: { module, entryPoint: 'main' },
			} );

		}

		let buffers = this._inputBuffers;
		if ( ! buffers || buffers.width !== width || buffers.height !== height ) {

			this._disposeInputBuffers();

			const createBuffer = () => device.createBuffer( {
				size: 16 * width * height,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} );
			buffers = { width, height, color: createBuffer(), albedo: createBuffer(), normal: createBuffer() };
			this._inputBuffers = buffers;

		}

		renderer.initTexture( color );
		const bindGroup = device.createBindGroup( {
			layout: this._resolvePipeline.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 0, resource: backend.get( color ).texture.createView() },
				{ binding: 1, resource: { buffer: backend.get( aux ).buffer } },
				{ binding: 2, resource: { buffer: buffers.color } },
				{ binding: 3, resource: { buffer: buffers.albedo } },
				{ binding: 4, resource: { buffer: buffers.normal } },
			],
		} );

		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline( this._resolvePipeline );
		pass.setBindGroup( 0, bindGroup );
		pass.dispatchWorkgroups( Math.ceil( width / 8 ), Math.ceil( height / 8 ) );
		pass.end();
		device.queue.submit( [ encoder.finish() ] );

		return buffers;

	}

	_disposeInputBuffers() {

		const buffers = this._inputBuffers;
		if ( buffers ) {

			buffers.color.destroy();
			buffers.albedo.destroy();
			buffers.normal.destroy();
			this._inputBuffers = null;

		}

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
	// since copyBufferToTexture requires 256 byte row alignment.
	// TODO: remove the copy once oidn-webgpu can write into a caller-provided storage texture.
	_copyOutputToTexture( output, width, height ) {

		const device = this.renderer.backend.device;

		if ( ! this._resultPipeline ) {

			const module = device.createShaderModule( {
				code: /* wgsl */`
					@group( 0 ) @binding( 0 ) var<storage, read> src : array<vec4f>;
					@group( 0 ) @binding( 1 ) var dst : texture_storage_2d<rgba16float, write>;

					@compute @workgroup_size( 8, 8 )
					fn main( @builtin( global_invocation_id ) gid : vec3u ) {

						let dims = textureDimensions( dst );
						if ( gid.x >= dims.x || gid.y >= dims.y ) {

							return;

						}

						textureStore( dst, gid.xy, src[ gid.y * dims.x + gid.x ] );

					}
				`,
			} );

			this._resultPipeline = device.createComputePipeline( {
				layout: 'auto',
				compute: { module, entryPoint: 'main' },
			} );

		}

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

		const bindGroup = device.createBindGroup( {
			layout: this._resultPipeline.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 0, resource: { buffer: output.data } },
				{ binding: 1, resource: this._rawTexture.createView() },
			],
		} );

		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline( this._resultPipeline );
		pass.setBindGroup( 0, bindGroup );
		pass.dispatchWorkgroups( Math.ceil( width / 8 ), Math.ceil( height / 8 ) );
		pass.end();
		device.queue.submit( [ encoder.finish() ] );

	}

}
