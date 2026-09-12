import {
	ACESFilmicToneMapping,
	Scene,
	WebGPURenderer,
	PerspectiveCamera,
	Vector3,
	Box3,
	EquirectangularReflectionMapping,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './src/LoaderElement.js';
import { Backdrop } from './src/Backdrop.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { initUNetFromURL } from 'oidn-web';
import { Upscaler } from '@pmndrs/upscaler';
import { WebGPUPathTracer, OIDNDenoiser, FSRUpscaler } from 'three-gpu-pathtracer/webgpu';

// the library ships neither "oidn-web" nor the network weights, so the app provides both
const WEIGHTS_AUX_URL = new URL( './src/denoise/rt_hdr_alb_nrm.tza', import.meta.url ).toString();
const WEIGHTS_COLOR_URL = new URL( './src/denoise/rt_hdr.tza', import.meta.url ).toString();

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/vehicles/toyota-supra-gt300.glb';
const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/modern_buildings_2_2k.hdr';
const CREDITS = 'Model by "vecarz" on Sketchfab';
const DESCRIPTION = 'Path tracing at a reduced resolution, denoised with OIDN and upscaled with FSR1.';

const params = {
	enable: true,
	transparentBackground: false,
	renderScale: 0.5,
	maxSamples: 6,
	denoise: true,
	upscale: true,
	sharpness: 1,
};

let pathTracer, denoiser, upscaler, renderer, controls;
let camera, scene, environmentMap;
let loader, gui;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	renderer = new WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.renderScale = params.renderScale;
	pathTracer.maxSamples = params.maxSamples;

	// Denoising and upscaling are opt in - construct the instance, set anything it exposes, and
	// hand it to the path tracer. It runs both as part of "renderSample".
	denoiser = new OIDNDenoiser( {
		initUNetFromURL,
		auxWeightsUrl: WEIGHTS_AUX_URL,
		colorWeightsUrl: WEIGHTS_COLOR_URL,
	} );

	upscaler = new FSRUpscaler( { Upscaler } );
	upscaler.sharpness = params.sharpness;

	pathTracer.setDenoiser( params.denoise ? denoiser : null );
	pathTracer.setUpscaler( params.upscale ? upscaler : null );

	camera = new PerspectiveCamera( 50, 1, 0.025, 500 );
	camera.position.set( 0, 2, 4 ).multiplyScalar( 1.2 );

	scene = new Scene();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 0.5;
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();

	} );
	controls.update();

	const dracoLoader = new DRACOLoader();
	const [ envMap, gltf ] = await Promise.all( [
		new HDRLoader().loadAsync( ENV_URL ),
		new GLTFLoader().setDRACOLoader( dracoLoader ).loadAsync( MODEL_URL ),
	] );
	dracoLoader.dispose();

	envMap.mapping = EquirectangularReflectionMapping;
	scene.environment = envMap;
	scene.environmentRotation.y = 0.4;
	environmentMap = envMap;
	updateBackground();

	// angle the model a little for some visual interest
	gltf.scene.rotation.y = Math.PI / 5;
	gltf.scene.updateMatrixWorld( true );
	scene.add( gltf.scene );

	// backdrop behind the model
	const backdrop = new Backdrop( { width: 16.3, depth: 7.2, height: 3.6, curve: 3.6 } );
	const box = new Box3().setFromObject( gltf.scene );
	const center = box.getCenter( new Vector3() );
	backdrop.position.set( center.x, box.min.y - 1e-3, box.min.z );
	scene.add( backdrop );

	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

	// gui
	gui = new GUI();

	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'enable' );
	ptFolder.add( params, 'transparentBackground' ).onChange( () => {

		updateBackground();

	} );
	ptFolder.add( params, 'renderScale', 0.1, 1.0, 0.05 ).onChange( v => {

		pathTracer.renderScale = v;

	} );
	ptFolder.add( params, 'maxSamples', 1, 50, 1 ).onChange( v => {

		pathTracer.maxSamples = v;

	} );

	const settingsFolder = gui.addFolder( 'upscale settings' );
	settingsFolder.add( params, 'denoise' ).onChange( v => {

		pathTracer.setDenoiser( v ? denoiser : null );

	} );
	settingsFolder.add( params, 'upscale' ).onChange( v => {

		pathTracer.setUpscaler( v ? upscaler : null );

	} );

	// per instance settings live on the instance
	settingsFolder.add( params, 'sharpness', 0, 1, 0.01 ).onChange( v => {

		upscaler.sharpness = v;

	} );

	window.addEventListener( 'resize', onResize );

	onResize();
	renderer.setAnimationLoop( animate );

}

// with no background the path tracer falls back to the renderer's clear color
function updateBackground() {

	const transparent = params.transparentBackground;

	scene.background = transparent ? null : environmentMap;
	renderer.setClearAlpha( transparent ? 0 : 1 );
	document.body.classList.toggle( 'checkerboard', transparent );

	pathTracer.updateEnvironment();

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function animate() {

	// the rasterized scene, for comparison against the path traced result
	if ( ! params.enable ) {

		renderer.render( scene, camera );
		return;

	}

	pathTracer.renderSample();

	pathTracer.getSampleCountsAsync().then( counts => loader.setSamples( counts ) );

}
