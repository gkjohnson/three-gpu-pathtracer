import {
	ACESFilmicToneMapping,
	NoToneMapping,
	Scene,
	WebGPURenderer,
	PerspectiveCamera,
	MeshBasicNodeMaterial,
	RenderTarget,
	StorageTexture,
	ExternalTexture,
	HalfFloatType,
	NearestFilter,
	NoBlending,
} from 'three/webgpu';
import { texture, mrt, diffuseColor, normalView, vec4 } from 'three/tsl';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { initUNetFromURL } from 'oidn-web';
import { LoaderElement } from './utils/LoaderElement.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
// the weights are stored with git lfs, so they come from the media host rather than "raw", which
// serves only the lfs pointer file. the guided and color only models are separate downloads.
const WEIGHTS_BASE_URL = 'https://media.githubusercontent.com/media/RenderKit/oidn-weights/master';
const WEIGHTS_AUX = 'rt_hdr_alb_nrm.tza';
const WEIGHTS_COLOR = 'rt_hdr.tza';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = 'Path tracing denoised with Open Image Denoise, using rasterized albedo and normal buffers.';

const DISPLAY_BEAUTY = 'Beauty';
const DISPLAY_ALBEDO = 'Albedo';
const DISPLAY_NORMAL = 'Normal';

const params = {
	display: DISPLAY_BEAUTY,
	denoise: false,
	maxSamples: 32,
	useAux: true,
};

let pathTracer, renderer, controls;
let camera, scene;
let loader, gui;
let aovTarget, aovFlipTarget;
let flipQuad, flipAlbedoNode, flipNormalNode;
let beautyQuad, beautyTexNode;
let aovQuad, aovTexNode;

// The guided and color only models are separate networks with their own weights, so one is kept
// for each and loaded the first time it is asked for.
const unets = { aux: null, color: null };
let unetLoading = false;

// the denoiser runs over several frames, so a run is kicked off only once the previous finished
let denoisedTexture = null;
let denoiseRunning = false;
let denoiseComplete = false;
let abortDenoise = null;
let resultPipeline = null;
let resultGPUTexture = null;

// sample counts are measured asynchronously, so the average is kept for the max samples check
let averageSamples = 0;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer. "shader-f16" lets the denoiser run its half precision path, and it can only be
	// asked for when the device is created. three drops it silently if the adapter lacks it.
	renderer = new WebGPURenderer( { antialias: true, requiredFeatures: [ 'shader-f16' ] } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.maxSamples = params.maxSamples;

	// The albedo and normal buffers a denoiser needs are rasterized rather than path traced, so
	// they cost one extra scene draw and need no support from the path tracer itself.
	// The path traced color is jittered per sample, so its silhouettes are a real blend of what is
	// in front and behind. A single sample rasterization snaps those same pixels to one surface,
	// and the denoiser follows the buffers rather than the color, leaving a fringe along every
	// edge. Multisampling the pass puts the two back in agreement. Half float rather than full,
	// since multisampled rgba32float is not broadly supported and the range is plenty either way.
	aovTarget = new RenderTarget( 1, 1, {
		count: 2,
		type: HalfFloatType,
		minFilter: NearestFilter,
		magFilter: NearestFilter,
		depthBuffer: true,
		samples: 4,
	} );

	// the MRT keys are matched against these names
	aovTarget.textures[ 0 ].name = 'output';
	aovTarget.textures[ 1 ].name = 'normal';

	// The denoiser reads all three of its inputs with the same indexing, but a rasterized target is
	// stored top down while the path traced color is bottom up. So the buffers are flipped into a
	// second target to match the color before being handed over, otherwise every pixel would be
	// guided by the albedo and normal of its mirrored row.
	aovFlipTarget = aovTarget.clone();
	aovFlipTarget.textures[ 0 ].name = 'output';
	aovFlipTarget.textures[ 1 ].name = 'normal';

	// Rendering a quad into a render target already inverts y relative to drawing to the canvas, so
	// the copy alone provides the flip. Sampling with an explicit flipY here cancels it out.
	flipAlbedoNode = texture( aovTarget.textures[ 0 ] );
	flipNormalNode = texture( aovTarget.textures[ 1 ] );
	flipQuad = new FullScreenQuad( new MeshBasicNodeMaterial( {
		colorNode: flipAlbedoNode,
		blending: NoBlending,
		toneMapped: false,
	} ) );

	// A rasterized render target is stored top down while the path tracer's target is bottom up,
	// since it maps a pixel's uv straight to ndc. So the two are presented with different uvs.
	beautyTexNode = texture( new StorageTexture( 1, 1 ) );
	beautyQuad = new FullScreenQuad( new MeshBasicNodeMaterial( {
		colorNode: vec4( beautyTexNode.rgb, 1.0 ),
		blending: NoBlending,
	} ) );

	// The debug views show the flipped buffers, which are the exact textures handed to the denoiser,
	// so they share the beauty view's orientation. Both are already in [0,1] and hold data rather
	// than color, so they display as stored and are not tone mapped.
	aovTexNode = texture( new StorageTexture( 1, 1 ) );
	aovQuad = new FullScreenQuad( new MeshBasicNodeMaterial( {
		colorNode: vec4( aovTexNode.rgb, 1.0 ),
		blending: NoBlending,
		toneMapped: false,
	} ) );

	// camera
	camera = new PerspectiveCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	// scene
	scene = new Scene();

	// a smooth gradient keeps the lighting low variance so the noise on show is the path tracer's
	// own rather than fireflies from a bright hdr
	const gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( 0x6a8fb5 );
	gradientMap.bottomColor.set( 0xe8e8e8 );
	gradientMap.update();

	scene.background = gradientMap;
	scene.environment = gradientMap;
	scene.environmentIntensity = 2;

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 10;
	controls.addEventListener( 'change', () => {

		// the image is starting over, so the denoised frame no longer matches it and the live
		// render should be what's on screen while the camera moves
		pathTracer.updateCamera();
		resetDenoise();

	} );
	controls.update();

	const gltf = await new GLTFLoader().loadAsync( MODEL_URL );
	scene.add( gltf.scene );

	// initialize the path tracer
	pathTracer.setScene( scene, camera );

	await loadUNet( true );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

	buildGui();

	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

function buildGui() {

	gui = new GUI();
	gui.add( params, 'denoise' ).onChange( resetDenoise );
	gui.add( params, 'maxSamples', 1, 200, 1 ).onChange( v => {

		pathTracer.maxSamples = v;
		resetDenoise();

	} );
	gui.add( params, 'useAux' ).name( 'guide with albedo + normal' ).onChange( resetDenoise );
	gui.add( params, 'display', [ DISPLAY_BEAUTY, DISPLAY_ALBEDO, DISPLAY_NORMAL ] );

}

function onResize() {

	// update resolution
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	// update camera
	pathTracer.updateCamera();

}

// OIDN wants a transmissive first hit to take its albedo and normal from whatever is behind the
// glass, since that is the detail the color buffer actually shows. Rasterization gets that by not
// drawing the transmissive surfaces at all.
const _hiddenMeshes = [];

function setTransmissiveVisible( visible ) {

	if ( visible ) {

		_hiddenMeshes.forEach( c => c.visible = true );
		_hiddenMeshes.length = 0;
		return;

	}

	scene.traverse( c => {

		const material = c.material;
		if ( c.visible && material && ( material.transmission > 0 || material.transparent ) ) {

			c.visible = false;
			_hiddenMeshes.push( c );

		}

	} );

}

// Rasterizes the albedo and normal of the closest surface, then flips them into the orientation the
// path traced color uses. Costs one extra scene draw and a copy, and needs no support from the path
// tracer itself.
function renderAovs() {

	const target = pathTracer.target;
	if ( ! target ) {

		return;

	}

	if ( aovTarget.width !== target.width || aovTarget.height !== target.height ) {

		aovTarget.setSize( target.width, target.height );

	}

	const originalMRT = renderer.getMRT();
	const originalToneMapping = renderer.toneMapping;

	// the buffers are data rather than an image, so they must not be tone mapped
	renderer.toneMapping = NoToneMapping;
	renderer.setRenderTarget( aovTarget );
	// oidn-web takes normals mapped into [0,1] rather than the signed range the OIDN docs describe.
	// Its own reference inputs use (0.5, 0.5, 1) for a flat normal, and it documents the cpu path as
	// taking Uint8ClampedArray, which cannot carry negatives at all.
	renderer.setMRT( mrt( {
		output: diffuseColor,
		normal: vec4( normalView.mul( 0.5 ).add( 0.5 ), 1.0 ),
	} ) );

	setTransmissiveVisible( false );
	renderer.render( scene, camera );
	setTransmissiveVisible( true );

	// flip both buffers into the orientation the path traced color uses
	if ( aovFlipTarget.width !== target.width || aovFlipTarget.height !== target.height ) {

		aovFlipTarget.setSize( target.width, target.height );

	}

	renderer.setRenderTarget( aovFlipTarget );
	renderer.setMRT( mrt( {
		output: flipAlbedoNode,
		normal: flipNormalNode,
	} ) );

	flipQuad.render( renderer );

	renderer.setMRT( originalMRT );
	renderer.setRenderTarget( null );
	renderer.toneMapping = originalToneMapping;

}

// The denoiser shares the renderer's device so the path traced color and the rasterized buffers can
// be handed over as gpu textures with no readback. Sharing the device is also why "shader-f16" had
// to be requested when the renderer was created.
async function loadUNet( aux ) {

	const key = aux ? 'aux' : 'color';
	if ( unets[ key ] || unetLoading ) {

		return unets[ key ];

	}

	unetLoading = true;

	const device = renderer.backend.device;
	const adapterInfo = device.adapterInfo ?? ( await navigator.gpu.requestAdapter() ).info;
	const url = `${ WEIGHTS_BASE_URL }/${ aux ? WEIGHTS_AUX : WEIGHTS_COLOR }`;

	unets[ key ] = await initUNetFromURL( url, { device, adapterInfo }, { aux, hdr: true } );
	unetLoading = false;

	return unets[ key ];

}

// three keeps the WebGPU texture alongside the three texture once it has been rendered to
function getGPUTexture( tex ) {

	return renderer.backend.get( tex ).texture;

}

// Hands the current color plus the two rasterized buffers to the denoiser. The work is spread over
// several frames internally, so "done" can land many frames later.
function runDenoise() {

	const useAux = params.useAux;
	const unet = unets[ useAux ? 'aux' : 'color' ];
	const target = pathTracer.target;

	if ( denoiseComplete ) {

		return;

	}

	if ( ! unet || denoiseRunning || ! target ) {

		// pull the weights in the first time this model is asked for
		if ( ! unet && ! unetLoading ) {

			loadUNet( useAux );

		}

		return;

	}

	const width = target.width;
	const height = target.height;
	const color = getGPUTexture( target );
	if ( ! color ) {

		return;

	}

	const inputs = {
		color: { data: color, width, height },

		// the library seeds the output with the raw color, so copying it after each tile shows the
		// denoise sweeping across the image rather than the frame sitting still until it finishes
		progress( result ) {

			writeResultToTexture( result, width, height );

		},
		done( result ) {

			writeResultToTexture( result, width, height );
			denoiseRunning = false;
			denoiseComplete = true;
			abortDenoise = null;

		},
	};

	// the guided model weights its filtering by the surface under each pixel, so it needs both
	// buffers. the color only model must not be given them at all.
	if ( useAux ) {

		renderAovs();

		const albedo = getGPUTexture( aovFlipTarget.textures[ 0 ] );
		const normal = getGPUTexture( aovFlipTarget.textures[ 1 ] );
		if ( ! albedo || ! normal ) {

			return;

		}

		inputs.albedo = { data: albedo, width, height };
		inputs.normal = { data: normal, width, height };

	}

	denoiseRunning = true;
	abortDenoise = unet.tileExecute( inputs );

}

// Drops any in flight run and the last result, so a settings change takes effect immediately
// rather than showing a frame produced under the old settings.
function resetDenoise() {

	if ( abortDenoise ) {

		abortDenoise();
		abortDenoise = null;

	}

	if ( denoisedTexture ) {

		denoisedTexture.dispose();
		denoisedTexture = null;

	}

	resultGPUTexture?.destroy();
	resultGPUTexture = null;

	denoiseRunning = false;
	denoiseComplete = false;

}

// The denoised result is a gpu buffer of one vec4 per pixel. Copying it into a texture with
// copyBufferToTexture would need each row padded to 256 bytes, which a tightly packed buffer is
// not, so a compute pass reads the buffer and writes the texture instead. Nothing leaves the gpu.
function ensureResultPipeline() {

	if ( resultPipeline ) {

		return;

	}

	const device = renderer.backend.device;
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

	resultPipeline = device.createComputePipeline( {
		layout: 'auto',
		compute: { module, entryPoint: 'main' },
	} );

}

function writeResultToTexture( result, width, height ) {

	const device = renderer.backend.device;
	ensureResultPipeline();

	if ( ! resultGPUTexture || resultGPUTexture.width !== width || resultGPUTexture.height !== height ) {

		resultGPUTexture?.destroy();
		resultGPUTexture = device.createTexture( {
			size: [ width, height ],
			format: 'rgba16float',
			usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
		} );

		// ExternalTexture lets three sample a gpu texture it did not create
		denoisedTexture?.dispose();
		denoisedTexture = new ExternalTexture( resultGPUTexture );

	}

	const bindGroup = device.createBindGroup( {
		layout: resultPipeline.getBindGroupLayout( 0 ),
		entries: [
			{ binding: 0, resource: { buffer: result.data } },
			{ binding: 1, resource: resultGPUTexture.createView() },
		],
	} );

	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline( resultPipeline );
	pass.setBindGroup( 0, bindGroup );
	pass.dispatchWorkgroups( Math.ceil( width / 8 ), Math.ceil( height / 8 ) );
	pass.end();
	device.queue.submit( [ encoder.finish() ] );

}

function animate() {

	requestAnimationFrame( animate );

	// the path tracer stops itself at maxSamples, so this only decides when to denoise
	const settled = averageSamples >= params.maxSamples;
	pathTracer.renderSample();

	// Everything is presented here rather than relying on the path tracer's own blit, so switching
	// display modes takes effect on the next frame instead of waiting for the path tracer to redraw.
	if ( ! pathTracer.target ) {

		return;

	}

	renderer.setRenderTarget( null );

	if ( params.display === DISPLAY_BEAUTY ) {

		// one pass, once the render has finished
		if ( params.denoise && settled ) {

			runDenoise();

		}

		// until the first denoised frame lands there is nothing to show but the raw image
		const showDenoised = params.denoise && denoisedTexture !== null;
		beautyTexNode.value = showDenoised ? denoisedTexture : pathTracer.target;
		beautyQuad.render( renderer );

	} else {

		renderAovs();

		const isAlbedo = params.display === DISPLAY_ALBEDO;
		aovTexNode.value = isAlbedo ? aovFlipTarget.textures[ 0 ] : aovFlipTarget.textures[ 1 ];

		// renderAovs leaves the aov target bound
		renderer.setRenderTarget( null );
		aovQuad.render( renderer );

	}

	pathTracer.getSampleCountsAsync().then( counts => {

		averageSamples = counts.avg;
		loader.setSamples( counts );

	} );

}
