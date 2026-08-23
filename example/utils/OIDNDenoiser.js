import {
	ExternalTexture,
	UnsignedByteType,
	NearestFilter,
	NoToneMapping,
	RenderTarget,
} from 'three/webgpu';
import { mrt, diffuseColor, normalView, vec4 } from 'three/tsl';
import { initUNetFromURL } from 'oidn-web';

// The weights are stored with git lfs, so "raw" serves only the pointer file and they come from
// the media host instead.
const WEIGHTS_BASE_URL = 'https://media.githubusercontent.com/media/RenderKit/oidn-weights/master';
const WEIGHTS_AUX = 'rt_hdr_alb_nrm.tza';
const WEIGHTS_COLOR = 'rt_hdr.tza';

/**
 * Runs Open Image Denoise over a path traced image. Shares the renderer's device, so nothing is
 * read back to the CPU. The albedo and normal buffers that guide the filter are rasterized from
 * the scene, so this needs no support from the path tracer itself.
 *
 *     const denoiser = new OIDNDenoiser( renderer );
 *
 *     denoiser.denoise( pathTracer.target, scene, camera );
 *     quad.material.map = denoiser.texture ?? pathTracer.target;
 *
 * Create the renderer with `requiredFeatures: [ 'shader-f16' ]` for the half precision path, since
 * WebGPU features cannot be enabled after the device exists.
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
	 * The rasterized albedo buffer handed to the denoiser.
	 *
	 * @type {Texture}
	 */
	get albedoTexture() {

		return this._auxTarget.textures[ 0 ];

	}

	/**
	 * The rasterized normal buffer handed to the denoiser.
	 *
	 * @type {Texture}
	 */
	get normalTexture() {

		return this._auxTarget.textures[ 1 ];

	}

	/**
	 * Whether to guide the filter with the albedo and normal buffers. The two models are separate
	 * networks, so switching downloads a different set of weights.
	 *
	 * @type {boolean}
	 * @default true
	 */
	get useAux() {

		return this._useAux;

	}

	set useAux( v ) {

		if ( this._useAux !== v ) {

			this._useAux = v;
			this.reset();

		}

	}

	/**
	 * @param {WebGPURenderer} renderer
	 */
	constructor( renderer ) {

		this.renderer = renderer;

		this._useAux = true;
		this._texture = null;
		this._running = false;
		this._complete = false;
		this._abort = null;

		// one network per model, loaded the first time it is asked for
		this._unets = { aux: null, color: null };
		this._loading = false;

		// Eight bits per channel, since both buffers hold [0,1] and that is the precision oidn-web
		// documents for them. Multisampled so the rasterized silhouettes match the jittered path
		// traced ones.
		this._auxTarget = new RenderTarget( 1, 1, {
			count: 2,
			type: UnsignedByteType,
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			depthBuffer: true,
			samples: 4,
		} );

		// the MRT keys are matched against these names
		this._auxTarget.textures[ 0 ].name = 'output';
		this._auxTarget.textures[ 1 ].name = 'normal';

		this._resultPipeline = null;
		this._resultTexture = null;

	}

	/**
	 * Runs a pass unless one is already running or finished. Call it once the image has settled,
	 * since denoising a moving image is wasted work.
	 *
	 * @param {Texture} color - The path traced result, in linear HDR.
	 * @param {Scene} scene - Used to rasterize the albedo and normal buffers.
	 * @param {Camera} camera
	 */
	denoise( color, scene, camera ) {

		const useAux = this._useAux;
		const unet = this._unets[ useAux ? 'aux' : 'color' ];

		if ( this._complete || this._running ) {

			return;

		}

		if ( ! unet ) {

			this._loadUNet( useAux );
			return;

		}

		const colorGPU = this._getGPUTexture( color );
		if ( ! colorGPU ) {

			return;

		}

		const { width, height } = color;
		const inputs = {
			color: { data: colorGPU, width, height },

			// the output is seeded with the raw color, so copying per tile shows a progressive wipe
			progress: result => this._writeResult( result, width, height ),
			done: result => {

				this._writeResult( result, width, height );
				this._running = false;
				this._complete = true;
				this._abort = null;

			},
		};

		// the guided model needs both buffers, and the color only model must not be given them
		if ( useAux ) {

			this.renderAux( color, scene, camera );

			const albedo = this._getGPUTexture( this.albedoTexture );
			const normal = this._getGPUTexture( this.normalTexture );
			if ( ! albedo || ! normal ) {

				return;

			}

			inputs.albedo = { data: albedo, width, height };
			inputs.normal = { data: normal, width, height };

		}

		this._running = true;
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

		this._resultTexture?.destroy();
		this._resultTexture = null;

		this._running = false;
		this._complete = false;

	}

	dispose() {

		this.reset();

		this._auxTarget.dispose();

	}

	async _loadUNet( aux ) {

		const key = aux ? 'aux' : 'color';
		if ( this._unets[ key ] || this._loading ) {

			return this._unets[ key ];

		}

		this._loading = true;

		const device = this.renderer.backend.device;
		const adapterInfo = device.adapterInfo ?? ( await navigator.gpu.requestAdapter() ).info;
		const url = `${ WEIGHTS_BASE_URL }/${ aux ? WEIGHTS_AUX : WEIGHTS_COLOR }`;

		this._unets[ key ] = await initUNetFromURL( url, { device, adapterInfo }, { aux, hdr: true } );
		this._loading = false;

		return this._unets[ key ];

	}

	// three only keeps a WebGPU texture alongside a three texture once it has registered it, which
	// has not happened for a freshly cloned render target
	_getGPUTexture( tex ) {

		this.renderer.initTexture( tex );
		return this.renderer.backend.get( tex ).texture;

	}

	/**
	 * Rasterizes the albedo and normal buffers without denoising. Run as part of "denoise", and
	 * exposed so they can be displayed before a pass has run.
	 *
	 * @param {Texture} color - Only its dimensions are used.
	 * @param {Scene} scene
	 * @param {Camera} camera
	 */
	renderAux( color, scene, camera ) {

		const { renderer, _auxTarget } = this;
		const { width, height } = color;

		if ( _auxTarget.width !== width || _auxTarget.height !== height ) {

			_auxTarget.setSize( width, height );

		}

		const originalMRT = renderer.getMRT();
		const originalToneMapping = renderer.toneMapping;

		// the buffers are data rather than an image, so they must not be tone mapped
		renderer.toneMapping = NoToneMapping;
		renderer.setRenderTarget( _auxTarget );

		// oidn-web takes normals mapped into [0,1], not the signed range the OIDN docs describe.
		// Its own reference inputs use (0.5, 0.5, 1) for a flat normal.
		renderer.setMRT( mrt( {
			output: diffuseColor,
			normal: vec4( normalView.mul( 0.5 ).add( 0.5 ), 1.0 ),
		} ) );

		renderer.render( scene, camera );

		renderer.setMRT( originalMRT );
		renderer.setRenderTarget( null );
		renderer.toneMapping = originalToneMapping;

	}

	// The result is a gpu buffer of one vec4 per pixel. copyBufferToTexture would need each row
	// padded to 256 bytes, which a packed buffer is not, so a compute pass writes the texture.
	_writeResult( result, width, height ) {

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

		if ( ! this._resultTexture || this._resultTexture.width !== width || this._resultTexture.height !== height ) {

			this._resultTexture?.destroy();
			this._resultTexture = device.createTexture( {
				size: [ width, height ],
				format: 'rgba16float',
				usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
			} );

			// ExternalTexture lets three sample a gpu texture it did not create. It has no image
			// behind it, so its size is set explicitly or "texture.width" reports zero.
			this._texture?.dispose();
			this._texture = new ExternalTexture( this._resultTexture );
			this._texture.image = { width, height };

		}

		const bindGroup = device.createBindGroup( {
			layout: this._resultPipeline.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 0, resource: { buffer: result.data } },
				{ binding: 1, resource: this._resultTexture.createView() },
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
