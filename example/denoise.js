import {
	ACESFilmicToneMapping,
	Scene,
	WebGPURenderer,
	PerspectiveCamera,
	MeshBasicNodeMaterial,
	StorageTexture,
	NoBlending,
	Vector2,
} from 'three/webgpu';
import { texture, uniform, mix, vec4 } from 'three/tsl';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Upscaler } from '@pmndrs/upscaler';
import { LoaderElement } from './utils/LoaderElement.js';
import { OIDNDenoiser } from './utils/OIDNDenoiser.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = 'Path tracing at a reduced resolution, denoised with OIDN and upscaled with FSR1.';

const params = {
	renderScale: 0.25,
	maxSamples: 32,
	denoise: true,
	upscale: true,
	sharpness: 1,
};

let pathTracer, denoiser, renderer, controls;
let camera, scene;
let loader, gui;

// The final present. Both sides of the path tracer's low res to full res fade are upscaled, then
// crossfaded here, so the transition is not also a change in sharpness.
let quad, beautyTexNode, lowResTexNode, fadeUniform;

// One upscaler per fade side, since each holds a single output texture and its own configuration.
// The configured path is tracked alongside since the upscaler does not report it.
const beautyUpscale = { upscaler: null, path: null };
const lowResUpscale = { upscaler: null, path: null };

const _size = new Vector2();
let averageSamples = 0;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// "shader-f16" lets the denoiser run its half precision path, and it can only be asked for when
	// the device is created
	renderer = new WebGPURenderer( { antialias: true, requiredFeatures: [ 'shader-f16' ] } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.renderScale = params.renderScale;
	pathTracer.maxSamples = params.maxSamples;

	denoiser = new OIDNDenoiser( renderer );

	for ( const state of [ beautyUpscale, lowResUpscale ] ) {

		state.upscaler = new Upscaler( { renderer } );
		state.upscaler.init();
		state.upscaler.settings.sharpness = params.sharpness;

	}

	beautyTexNode = texture( new StorageTexture( 1, 1 ) );
	lowResTexNode = texture( new StorageTexture( 1, 1 ) );
	fadeUniform = uniform( 1 );
	quad = new FullScreenQuad( new MeshBasicNodeMaterial( {
		colorNode: vec4( mix( lowResTexNode.rgb, beautyTexNode.rgb, fadeUniform ), 1.0 ),
		blending: NoBlending,
	} ) );

	camera = new PerspectiveCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

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

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 10;
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();
		resetRender();

	} );
	controls.update();

	const gltf = await new GLTFLoader().loadAsync( MODEL_URL );
	scene.add( gltf.scene );

	pathTracer.setScene( scene, camera );

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
	gui.add( params, 'renderScale', 0.1, 1.0, 0.05 ).onChange( v => {

		pathTracer.renderScale = v;
		resetRender();

	} );
	gui.add( params, 'maxSamples', 1, 200, 1 ).onChange( v => {

		pathTracer.maxSamples = v;
		resetRender();

	} );
	gui.add( params, 'denoise' );
	gui.add( params, 'upscale' );
	gui.add( params, 'sharpness', 0, 1, 0.01 ).onChange( v => {

		beautyUpscale.upscaler.settings.sharpness = v;
		lowResUpscale.upscaler.settings.sharpness = v;

	} );

}

// The image is starting over, so the denoised result no longer matches it. Clearing the sample
// count also restarts the measurements that animate stops making once the render settles.
function resetRender() {

	denoiser.reset();
	averageSamples = 0;

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();
	resetRender();

}

// The upscaler is told both resolutions up front, so they are re-checked every frame. Returns null
// on the frame it reconfigures, since its output is still sized to the previous resolution.
function upscale( state, source, enabled ) {

	const { upscaler } = state;

	// the upscaler reads the raw GPUTexture, which only exists once three has registered it. A
	// freshly cloned render target or an ExternalTexture has not been through that yet.
	renderer.initTexture( source );

	renderer.getDrawingBufferSize( _size );

	const displayWidth = Math.max( 1, Math.round( _size.x ) );
	const displayHeight = Math.max( 1, Math.round( _size.y ) );

	// "bilinear" is the package's own naive baseline, so toggling compares like with like
	const path = enabled ? 'spatial' : 'bilinear';

	const matches =
		state.path === path &&
		upscaler.displayWidth === displayWidth &&
		upscaler.displayHeight === displayHeight &&
		upscaler.renderWidth === source.width &&
		upscaler.renderHeight === source.height;

	if ( ! matches ) {

		state.path = path;
		upscaler.configure( {
			displayWidth,
			displayHeight,
			renderWidth: source.width,
			renderHeight: source.height,
			path,
		} );

		return null;

	}

	upscaler.dispatch( { color: source }, camera );
	return upscaler.outputTexture;

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	const target = pathTracer.target;
	if ( ! target ) {

		return;

	}

	// The denoiser reads the accumulated result rather than the faded composite, so it only runs
	// once the path tracer has stopped at maxSamples.
	const settled = averageSamples >= params.maxSamples;
	if ( params.denoise && settled ) {

		denoiser.denoise( target, scene, camera );

	}

	// target ──> denoise ──> upscale ──┐
	//                                  ├─> crossfade ──> canvas
	// lowResTarget ─────────> upscale ─┘
	const beauty = params.denoise && denoiser.texture ? denoiser.texture : target;
	beautyTexNode.value = upscale( beautyUpscale, beauty, params.upscale ) ?? beauty;

	// While the path tracer is rendering a preview, "target" is that preview and there is nothing
	// to fade from. "lowResTarget" only holds anything meaningful once the full render takes over.
	const fade = pathTracer.lowResMode ? 1 : pathTracer.fadeState;
	fadeUniform.value = fade;

	// the preview is only worth upscaling while it is still visible
	if ( fade < 1 ) {

		const lowRes = pathTracer.lowResTarget;
		lowResTexNode.value = upscale( lowResUpscale, lowRes, params.upscale ) ?? lowRes;

	}

	renderer.setRenderTarget( null );
	quad.render( renderer );

	// measuring costs a full resolution pass, and the numbers cannot change once rendering stops
	if ( ! settled ) {

		pathTracer.getSampleCountsAsync().then( counts => {

			averageSamples = counts.avg;
			loader.setSamples( counts );

		} );

	}

}
