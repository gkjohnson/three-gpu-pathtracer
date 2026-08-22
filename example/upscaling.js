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
import { texture } from 'three/tsl';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { Upscaler } from '@pmndrs/upscaler';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = 'Path tracing at a reduced resolution, upscaled with AMD FidelityFX FSR1.';

const params = {
	upscale: true,
	renderScale: 0.25,
	pause: false,
};

let pathTracer, renderer, controls;
let camera, scene;
let loader, gui;
let upscaler, blitQuad, blitTexNode;
let configuredPath = null;

const _size = new Vector2();

// sample counts are measured asynchronously, so the average is kept for the pause check
let averageSamples = 0;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.renderScale = params.renderScale;
	pathTracer.tiles.set( 3, 3 );

	// FSR1 is the single frame spatial path, so the path traced color is all it needs. The temporal
	// path would want depth and motion vectors, which a converging path tracer has no use for.
	upscaler = new Upscaler( { renderer } );
	upscaler.init();

	// FSR loads and stores texels with the same indexing, so its output keeps the orientation of
	// the input and is presented the same way the path tracer presents its own target.
	blitTexNode = texture( new StorageTexture( 1, 1 ) );
	blitQuad = new FullScreenQuad( new MeshBasicNodeMaterial( {
		colorNode: blitTexNode,
		blending: NoBlending,
	} ) );

	// camera
	camera = new PerspectiveCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	// scene
	scene = new Scene();

	// a smooth gradient rather than an hdr keeps the lighting low variance, so the image converges
	// quickly and without fireflies to distract from the upscale quality
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
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	const gltf = await new GLTFLoader().loadAsync( MODEL_URL );
	scene.add( gltf.scene );

	// initialize the path tracer
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
	gui.add( params, 'upscale' ).name( 'FSR1 upscale' );
	gui.add( params, 'pause' );
	gui.add( params, 'renderScale', 0.1, 1.0, 0.01 ).onChange( v => {

		pathTracer.renderScale = v;

	} );

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

// The upscaler has to be told both resolutions up front, and the render resolution follows the
// render scale, so re-check them every frame and reconfigure when either moves. The path is checked
// here too since toggling FSR swaps it.
function updateUpscalerConfig( path ) {

	const target = pathTracer.target;
	renderer.getDrawingBufferSize( _size );

	const displayWidth = Math.max( 1, Math.round( _size.x ) );
	const displayHeight = Math.max( 1, Math.round( _size.y ) );

	const matches =
		configuredPath === path &&
		upscaler.displayWidth === displayWidth &&
		upscaler.displayHeight === displayHeight &&
		upscaler.renderWidth === target.width &&
		upscaler.renderHeight === target.height;

	if ( matches ) {

		return;

	}

	configuredPath = path;
	upscaler.configure( {
		displayWidth,
		displayHeight,
		renderWidth: target.width,
		renderHeight: target.height,
		path,
	} );

}

function animate() {

	requestAnimationFrame( animate );

	// this also blits the reduced resolution result to the canvas, which is the comparison point
	// when upscaling is turned off
	if ( ! params.pause || averageSamples < 1 ) {

		pathTracer.renderSample();

	}

	// Both paths present every frame so that toggling FSR while paused actually swaps the image.
	// "bilinear" is the package's own naive baseline, which keeps the comparison honest.
	if ( pathTracer.target ) {

		updateUpscalerConfig( params.upscale ? 'spatial' : 'bilinear' );
		upscaler.dispatch( { color: pathTracer.target }, camera );

		blitTexNode.value = upscaler.outputTexture;
		renderer.setRenderTarget( null );
		blitQuad.render( renderer );

	}

	pathTracer.getSampleCountsAsync().then( counts => {

		averageSamples = counts.avg;
		loader.setSamples( counts );

	} );

}
