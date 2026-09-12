import { ExternalTexture, NearestFilter, NoToneMapping, RenderTarget, UnsignedByteType } from 'three/webgpu';
import { diffuseColor, mrt, normalView, vec4 } from 'three/tsl';

/**
 * Runs Open Image Denoise over a path traced image. Pass one to
 * "WebGPUPathTracer.setDenoiser", or drive it directly with "denoise".
 *
 * "initUNetFromURL" and the weights are passed in rather than imported so neither "oidn-web"
 * nor the 1.8MB network files belong to this library.
 *
 *     import { initUNetFromURL } from 'oidn-web';
 *     pathTracer.setDenoiser( new OIDNDenoiser( { initUNetFromURL, auxWeightsUrl } ) );
 *
 * Weights come from the oidn-weights repository, where the "_small" and "_large" variants
 * trade quality against download size and per tile cost.
 */
export class OIDNDenoiser {

	/**
	 * The denoised result, or null until the first tile has been produced.
	 *
	 * @type {?ExternalTexture}
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
	 * @param {Object} options
	 * @param {Function} options.initUNetFromURL
	 * @param {string} options.auxWeightsUrl - Weights for the guided model.
	 * @param {string} [options.colorWeightsUrl] - Weights for the color only model, needed only
	 * when "useAuxiliaryBuffers" is off.
	 */
	constructor( options = {} ) {

		const { initUNetFromURL, auxWeightsUrl, colorWeightsUrl } = options;

		if ( ! initUNetFromURL ) {

			throw new Error( 'OIDNDenoiser: "initUNetFromURL" from "oidn-web" must be provided.' );

		}

		this.initUNetFromURL = initUNetFromURL;
		this.auxWeightsUrl = auxWeightsUrl;
		this.colorWeightsUrl = colorWeightsUrl;

		// rasterize albedo and normal to guide the filter. Off falls back to the color only
		// model, which is blurrier but skips a scene render
		this.useAuxiliaryBuffers = true;

		this.renderer = null;
		this.scene = null;
		this.camera = null;

		this._texture = null;
		this._running = false;
		this._complete = false;
		this._abort = null;
		this._requestId = 0;
		this._unets = { aux: null, color: null };

		this._resultPipeline = null;
		this._rawTexture = null;
		this._auxTarget = null;

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	init( renderer ) {

		this.renderer = renderer;

	}

	/**
	 * @param {Scene} scene
	 * @param {Camera} camera
	 */
	setScene( scene, camera ) {

		this.scene = scene;
		this.camera = camera;

	}

	/**
	 * Renders the auxiliary buffers and starts a pass. Safe to call every frame.
	 *
	 * @param {Texture} target - The path traced result, in linear HDR.
	 * @returns {?Texture}
	 */
	update( target ) {

		if ( ! this._complete && ! this._running ) {

			if ( this.useAuxiliaryBuffers && this.scene && this.camera ) {

				const auxTarget = this._renderAuxiliaryBuffers( target.width, target.height );
				this.denoise( target, auxTarget.textures[ 0 ], auxTarget.textures[ 1 ] );

			} else {

				this.denoise( target );

			}

		}

		return this._texture;

	}

	/**
	 * Runs a pass unless one is already running or finished. The optional albedo and normal
	 * buffers guide the filter and select the guided model. Both hold [0,1] values, with normals
	 * mapped so a flat normal is (0.5, 0.5, 1).
	 *
	 * @param {Texture} color - The path traced result, in linear HDR.
	 * @param {?Texture} albedo
	 * @param {?Texture} normal
	 */
	async denoise( color, albedo = null, normal = null ) {

		if ( this._complete || this._running ) {

			return;

		}

		this._running = true;

		const useAux = Boolean( albedo && normal );
		const requestId = ++ this._requestId;
		const unet = await this._initUNet( useAux );

		// bail if a reset or a newer call took over while the weights downloaded
		if ( requestId !== this._requestId || ! this._running ) {

			return;

		}

		// three only holds a WebGPU texture for a three texture once it has been initialized
		const { renderer } = this;
		const backend = renderer.backend;
		renderer.initTexture( color );

		const { width, height } = color;
		const inputs = {
			color: { data: backend.get( color ).texture, width, height },

			// the output is seeded with the raw color, so copying per tile shows a progressive wipe
			progress: output => this._copyOutputToTexture( output, width, height ),
			done: output => {

				this._copyOutputToTexture( output, width, height );
				this._running = false;
				this._complete = true;
				this._abort = null;

			},
		};

		// the guided model needs both buffers, and the color only model must not be given them
		if ( useAux ) {

			renderer.initTexture( albedo );
			renderer.initTexture( normal );
			inputs.albedo = { data: backend.get( albedo ).texture, width, height };
			inputs.normal = { data: backend.get( normal ).texture, width, height };

		}

		this._abort = unet.tileExecute( inputs );

	}

	/**
	 * Drops any running pass and the last result. Call it whenever the image changes, such as when
	 * the camera moves.
	 */
	reset() {

		if ( this._abort ) {

			this._abort();
			this._abort = null;

		}

		this._texture?.dispose();
		this._texture = null;

		this._rawTexture?.destroy();
		this._rawTexture = null;

		this._running = false;
		this._complete = false;

	}

	dispose() {

		this.reset();

		this._auxTarget?.dispose();
		this._auxTarget = null;

		// the networks hold the weights on the GPU, and a load may still be in flight
		for ( const key in this._unets ) {

			this._unets[ key ]?.then( unet => unet.dispose() );
			this._unets[ key ] = null;

		}

	}

	// Rasterizes the albedo and normal buffers that guide the filter. oidn-web takes normals
	// mapped into [0,1], with (0.5, 0.5, 1) as a flat normal.
	_renderAuxiliaryBuffers( width, height ) {

		const { renderer, scene, camera } = this;

		if ( ! this._auxTarget ) {

			// Eight bits per channel since both buffers hold [0,1]. Multisampled so the rasterized
			// silhouettes match the jittered path traced ones.
			this._auxTarget = new RenderTarget( 1, 1, {
				count: 2,
				type: UnsignedByteType,
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				samples: 4,
			} );

			// the MRT keys are matched against these names
			this._auxTarget.textures[ 0 ].name = 'output';
			this._auxTarget.textures[ 1 ].name = 'normal';

		}

		const auxTarget = this._auxTarget;
		if ( auxTarget.width !== width || auxTarget.height !== height ) {

			auxTarget.setSize( width, height );

		}

		const originalTarget = renderer.getRenderTarget();
		const originalMRT = renderer.getMRT();
		const originalToneMapping = renderer.toneMapping;

		// the buffers are data rather than an image, so they must not be tone mapped
		renderer.toneMapping = NoToneMapping;
		renderer.setRenderTarget( auxTarget );
		renderer.setMRT( mrt( {
			output: diffuseColor,
			normal: vec4( normalView.mul( 0.5 ).add( 0.5 ), 1.0 ),
		} ) );

		renderer.render( scene, camera );

		renderer.setMRT( originalMRT );
		renderer.setRenderTarget( originalTarget );
		renderer.toneMapping = originalToneMapping;

		return auxTarget;

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

				return this.initUNetFromURL( url, { device, adapterInfo: device.adapterInfo }, { aux, hdr: true } );

			} )();

		}

		return this._unets[ key ];

	}

	// Copies the denoiser's packed output buffer into a sampleable texture, using a compute pass
	// since copyBufferToTexture requires 256 byte row alignment.
	// TODO: remove the copy once oidn-web can write into a caller-provided storage texture.
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
