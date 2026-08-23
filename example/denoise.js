import {
	ACESFilmicToneMapping,
	Scene,
	WebGPURenderer,
	PerspectiveCamera,
	Vector2,
} from 'three/webgpu';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Upscaler } from '@pmndrs/upscaler';
import { LoaderElement } from './utils/LoaderElement.js';
import { OIDNDenoiser } from './utils/OIDNDenoiser.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer, RenderToScreenNodeMaterial } from 'three-gpu-pathtracer/webgpu';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = 'Path tracing at a reduced resolution, denoised with OIDN and upscaled with FSR1.';

const params = {
	enable: true,
	transparentBackground: false,
	renderScale: 0.25,
	maxSamples: 32,
	denoise: true,
	upscale: true,
	sharpness: 1,
};

let pathTracer, denoiser, renderer, controls;
let camera, scene, gradientMap;
let loader, gui;

// The final present. Both sides of the path tracer's low res to full res fade are upscaled, then
// crossfaded here, so the transition is not also a change in sharpness.
let quad;

// one upscaler per fade side, since each holds a single output texture and its own configuration
let beautyUpscaler, lowResUpscaler;

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

	beautyUpscaler = new Upscaler( { renderer } );
	lowResUpscaler = new Upscaler( { renderer } );
	for ( const upscaler of [ beautyUpscaler, lowResUpscaler ] ) {

		upscaler.init();
		upscaler.settings.sharpness = params.sharpness;

	}

	quad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

	camera = new PerspectiveCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	scene = new Scene();

	// a smooth gradient keeps the lighting low variance so the noise on show is the path tracer's
	// own rather than fireflies from a bright hdr
	gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( 0x6a8fb5 );
	gradientMap.bottomColor.set( 0xe8e8e8 );
	gradientMap.update();

	scene.environment = gradientMap;
	scene.environmentIntensity = 2;
	updateBackground();

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
	gui.add( params, 'enable' ).name( 'path trace' );
	gui.add( params, 'transparentBackground' ).onChange( () => {

		updateBackground();
		resetRender();

	} );
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

		beautyUpscaler.settings.sharpness = v;
		lowResUpscaler.settings.sharpness = v;

	} );

}

// with no background the path tracer falls back to the renderer's clear color
function updateBackground() {

	const transparent = params.transparentBackground;

	scene.background = transparent ? null : gradientMap;
	renderer.setClearAlpha( transparent ? 0 : 1 );
	document.body.classList.toggle( 'checkerboard', transparent );

	pathTracer.updateEnvironment();

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
function upscale( upscaler, source ) {

	// the upscaler reads the raw GPUTexture, which only exists once three has registered it. A
	// freshly cloned render target or an ExternalTexture has not been through that yet.
	renderer.initTexture( source );

	renderer.getDrawingBufferSize( _size );

	const displayWidth = Math.max( 1, Math.round( _size.x ) );
	const displayHeight = Math.max( 1, Math.round( _size.y ) );

	const matches =
		upscaler.displayWidth === displayWidth &&
		upscaler.displayHeight === displayHeight &&
		upscaler.renderWidth === source.width &&
		upscaler.renderHeight === source.height;

	if ( ! matches ) {

		upscaler.configure( {
			displayWidth,
			displayHeight,
			renderWidth: source.width,
			renderHeight: source.height,
			path: 'spatial',
		} );

		return null;

	}

	upscaler.dispatch( { color: source }, camera );
	return upscaler.outputTexture;

}

function animate() {

	requestAnimationFrame( animate );

	// the rasterized scene, for comparison against the path traced result
	if ( ! params.enable ) {

		renderer.setRenderTarget( null );
		renderer.render( scene, camera );
		return;

	}

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
	// FSR writes an opaque result, so upscaling drops the alpha
	const beauty = params.denoise && denoiser.texture ? denoiser.texture : target;
	quad.material.texture = params.upscale ? upscale( beautyUpscaler, beauty ) ?? beauty : beauty;

	// While the path tracer is rendering a preview, "target" is that preview and there is nothing
	// to fade from. "lowResTarget" only holds anything meaningful once the full render takes over.
	const fade = pathTracer.lowResMode ? 1 : pathTracer.fadeState;
	quad.material.transition = fade;

	// the preview is only worth upscaling while it is still visible
	if ( fade < 1 ) {

		const lowRes = pathTracer.lowResTarget;
		quad.material.fromTexture = params.upscale ? upscale( lowResUpscaler, lowRes ) ?? lowRes : lowRes;

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
