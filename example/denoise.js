import {
	ACESFilmicToneMapping,
	NearestFilter,
	NoToneMapping,
	RenderTarget,
	Scene,
	UnsignedByteType,
	WebGPURenderer,
	PerspectiveCamera,
	Vector2,
	Vector3,
	Box3,
	EquirectangularReflectionMapping,
} from 'three/webgpu';
import { diffuseColor, mrt, normalView, vec4 } from 'three/tsl';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Upscaler } from '@pmndrs/upscaler';
import { LoaderElement } from './src/LoaderElement.js';
import { Backdrop } from './src/Backdrop.js';
import { OIDNDenoiser } from './src/denoise/OIDNDenoiser.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { WebGPUPathTracer, RenderToScreenNodeMaterial } from 'three-gpu-pathtracer/webgpu';

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

let pathTracer, denoiser, renderer, controls;
let camera, scene, environmentMap;
let loader, gui;

let auxTarget, presentQuad;
let finalUpscaler, lowResUpscaler;

const _size = new Vector2();
let averageSamples = 0;

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

	denoiser = new OIDNDenoiser( renderer );

	// Eight bits per channel since both buffers hold [0,1]. Multisampled so the rasterized
	// silhouettes match the jittered path traced ones.
	auxTarget = new RenderTarget( 1, 1, {
		count: 2,
		type: UnsignedByteType,
		minFilter: NearestFilter,
		magFilter: NearestFilter,
		samples: 4,
	} );

	// the MRT keys are matched against these names
	auxTarget.textures[ 0 ].name = 'output';
	auxTarget.textures[ 1 ].name = 'normal';

	// Upscalers
	finalUpscaler = new Upscaler( { renderer } );
	lowResUpscaler = new Upscaler( { renderer } );
	for ( const upscaler of [ finalUpscaler, lowResUpscaler ] ) {

		upscaler.init();
		upscaler.settings.sharpness = params.sharpness;

	}

	presentQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

	camera = new PerspectiveCamera( 50, 1, 0.025, 500 );
	camera.position.set( 0, 2, 4 ).multiplyScalar( 1.2 );

	scene = new Scene();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 0.5;
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();
		resetRender();

	} );
	controls.update();

	const dracoLoader = new DRACOLoader();
	dracoLoader.setDecoderPath( 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/' );
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

	// backdrop behind the model, scaled to its bounds
	const box = new Box3().setFromObject( gltf.scene );
	const size = box.getSize( new Vector3() );
	const center = box.getCenter( new Vector3() );
	const dim = Math.max( size.x, size.y, size.z ) * 0.75;
	const backdrop = new Backdrop( { width: 4.5 * dim, depth: 2 * dim, height: 1 * dim, curve: dim } );
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
		resetRender();

	} );
	ptFolder.add( params, 'renderScale', 0.1, 1.0, 0.05 ).onChange( v => {

		pathTracer.renderScale = v;
		resetRender();

	} );
	ptFolder.add( params, 'maxSamples', 1, 50, 1 ).onChange( v => {

		pathTracer.maxSamples = v;
		resetRender();

	} );

	const settingsFolder = gui.addFolder( 'upscale settings' );
	settingsFolder.add( params, 'denoise' );
	settingsFolder.add( params, 'upscale' );
	settingsFolder.add( params, 'sharpness', 0, 1, 0.01 ).onChange( v => {

		finalUpscaler.settings.sharpness = v;
		lowResUpscaler.settings.sharpness = v;

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

// the image is starting over, so drop the stale denoised result and sample measurements
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

// Rasterizes the albedo and normal buffers that guide the denoiser. oidn-web takes normals mapped
// into [0,1], with (0.5, 0.5, 1) as a flat normal.
function renderAux( width, height, auxTarget ) {

	if ( auxTarget.width !== width || auxTarget.height !== height ) {

		auxTarget.setSize( width, height );

	}

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
	renderer.setRenderTarget( null );
	renderer.toneMapping = originalToneMapping;

}

// the upscaler is told both resolutions up front, so they are re-checked every frame
function upscale( upscaler, source ) {

	// the upscaler reads the raw GPUTexture, which only exists once three has initialized it
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

	}

	upscaler.dispatch( { color: source }, camera );
	return upscaler.outputTexture;

}

function animate() {

	// the rasterized scene, for comparison against the path traced result
	if ( ! params.enable ) {

		renderer.render( scene, camera );
		return;

	}

	pathTracer.renderSample();

	// start a denoise pass once the path tracer has stopped at maxSamples
	const target = pathTracer.target;
	const settled = averageSamples >= params.maxSamples;
	if ( params.denoise && settled && ! denoiser.running && ! denoiser.complete ) {

		renderAux( target.width, target.height, auxTarget );
		denoiser.denoise( target, auxTarget.textures[ 0 ], auxTarget.textures[ 1 ] );

	}

	// get the upscaled (and denoised if necessary) version of the final beauty textures
	const final = params.denoise && denoiser.texture ? denoiser.texture : target;
	presentQuad.material.texture = params.upscale ? upscale( finalUpscaler, final ) : final;

	// While in low res mode "target" is the preview itself and there is nothing to fade from, so
	// the transition is forced to 1. "lowResTarget" only holds content once the full render begins.
	const fade = pathTracer.lowResMode ? 1 : pathTracer.fadeState;

	// get the upscaled low res texture
	if ( fade < 1 ) {

		const lowRes = pathTracer.lowResTarget;
		presentQuad.material.fromTexture = params.upscale ? upscale( lowResUpscaler, lowRes ) : lowRes;

	}

	// render
	presentQuad.material.transition = fade;
	presentQuad.render( renderer );

	// measuring the sample counts costs a full resolution pass, so stop once the render settles
	if ( ! settled ) {

		pathTracer.getSampleCountsAsync().then( counts => {

			averageSamples = counts.avg;
			loader.setSamples( counts );

		} );

	}

}
