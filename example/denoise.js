import {
	ACESFilmicToneMapping,
	Scene,
	WebGPURenderer,
	PerspectiveCamera,
	MeshBasicNodeMaterial,
	StorageTexture,
	NoBlending,
} from 'three/webgpu';
import { texture, vec4 } from 'three/tsl';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { OIDNDenoiser } from './utils/OIDNDenoiser.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = 'Path tracing denoised with Open Image Denoise, guided by rasterized albedo and normal buffers.';

const DISPLAY_BEAUTY = 'Beauty';
const DISPLAY_ALBEDO = 'Albedo';
const DISPLAY_NORMAL = 'Normal';

const params = {
	denoise: false,
	maxSamples: 32,
	useAux: true,
	display: DISPLAY_BEAUTY,
};

let pathTracer, denoiser, renderer, controls;
let camera, scene;
let loader, gui;
let quad, quadTexNode;

// sample counts are measured asynchronously, so the average is kept for the settled check
let averageSamples = 0;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// "shader-f16" lets the denoiser run its half precision path, and it can only be asked for when
	// the device is created. three drops it silently if the adapter lacks it.
	renderer = new WebGPURenderer( { antialias: true, requiredFeatures: [ 'shader-f16' ] } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.maxSamples = params.maxSamples;

	denoiser = new OIDNDenoiser( renderer );

	// everything is presented here so switching display modes takes effect on the next frame
	quadTexNode = texture( new StorageTexture( 1, 1 ) );
	quad = new FullScreenQuad( new MeshBasicNodeMaterial( {
		colorNode: vec4( quadTexNode.rgb, 1.0 ),
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

		// the image is starting over, so the denoised frame no longer matches it
		pathTracer.updateCamera();
		denoiser.reset();

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
	gui.add( params, 'denoise' ).onChange( () => denoiser.reset() );
	gui.add( params, 'maxSamples', 1, 200, 1 ).onChange( v => {

		pathTracer.maxSamples = v;
		denoiser.reset();

	} );
	gui.add( params, 'useAux' ).name( 'guide with albedo + normal' ).onChange( v => denoiser.useAux = v );
	gui.add( params, 'display', [ DISPLAY_BEAUTY, DISPLAY_ALBEDO, DISPLAY_NORMAL ] );

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function animate() {

	requestAnimationFrame( animate );

	// the path tracer stops itself at maxSamples, so this only decides when to denoise
	const settled = averageSamples >= params.maxSamples;
	pathTracer.renderSample();

	if ( ! pathTracer.target ) {

		return;

	}

	if ( params.denoise && settled ) {

		denoiser.denoise( pathTracer.target, scene, camera );

	}

	if ( params.display !== DISPLAY_BEAUTY ) {

		// keep them current even when a denoise pass isn't running
		denoiser.renderAux( pathTracer.target, scene, camera );
		quadTexNode.value = params.display === DISPLAY_ALBEDO ? denoiser.albedoTexture : denoiser.normalTexture;

	} else {

		// until the first denoised tile lands there is nothing to show but the raw image
		quadTexNode.value = params.denoise && denoiser.texture ? denoiser.texture : pathTracer.target;

	}

	renderer.setRenderTarget( null );
	quad.render( renderer );

	pathTracer.getSampleCountsAsync().then( counts => {

		averageSamples = counts.avg;
		loader.setSamples( counts );

	} );

}
