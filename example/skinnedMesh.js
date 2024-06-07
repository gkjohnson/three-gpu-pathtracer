import {
	WebGLRenderer,
	ACESFilmicToneMapping,
	Scene,
	PerspectiveCamera,
	Clock,
	AnimationMixer,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlurredEnvMapGenerator, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';
const MORPH_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
const SKINNED_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf';
const CREDITS = 'Model by DailyArt on Sketchfab';
const DESCRIPTION = 'Rendering deformable geometry with path tracing.';

let pathTracer, renderer, controls, camera, scene, clock;
let mixer, mixerAction;
let loader;
let counter = 0;
const params = {

	bounces: 5,
	samplesPerFrame: 1,
	renderScale: 1 / window.devicePixelRatio,
	tiles: 1,
	autoPause: true,
	pause: false,
	continuous: false,
	stableNoise: false,
	...getScaledSettings(),

};

init();

async function init() {

	loader = new LoaderElement();
	loader.setDescription( DESCRIPTION );
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.multipleImportanceSampling = false;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.filterGlossyFactor = 0.25;
	pathTracer.minSamples = 1;
	pathTracer.renderDelay = 0;
	pathTracer.fadeDuration = 0;

	// scene
	scene = new Scene();

	// camera
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5.5, 3.5, 7.5 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// clock
	clock = new Clock();

	// load assets
	const modelUrl = window.location.hash === '#morphtarget' ? MORPH_URL : SKINNED_URL;
	const [ envTexture, gltf ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( modelUrl )
	] );

	// update env map
	const generator = new BlurredEnvMapGenerator( renderer );
	const blurredTex = generator.generate( envTexture, 0.1 );
	scene.background = blurredTex;
	scene.environment = blurredTex;
	generator.dispose();

	// animations
	const animations = gltf.animations;
	mixer = new AnimationMixer( gltf.scene );

	mixerAction = mixer.clipAction( animations[ 0 ] );
	mixerAction.play();
	mixerAction.paused = params.pause;

	// initialize scene
	scene.add( gltf.scene );

	const floorTex = generateRadialFloorTexture( 2048 );
	const floorPlane = new Mesh(
		new PlaneGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0xdddddd,
			roughness: 0.15,
			metalness: 1.0
		} )
	);
	floorPlane.scale.setScalar( 50 );
	floorPlane.rotation.x = - Math.PI / 2;
	floorPlane.position.y = 0.075;
	scene.add( floorPlane );

	// initial generation
	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	onResize();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	gui.add( params, 'bounces', 1, 10, 1 ).onChange( regenerateScene );
	gui.add( params, 'renderScale', 0.1, 1 ).onChange( v => {

		pathTracer.renderScale = v;
		pathTracer.reset();

	} );
	gui.add( params, 'autoPause' ).listen();
	gui.add( params, 'pause' ).onChange( v => {

		params.autoPause = false;
		setPause( v );

	} ).listen();
	gui.add( params, 'continuous' ).onChange( () => {

		params.autoPause = false;

	} );
	gui.add( params, 'stableNoise' ).onChange( v => {

		pathTracer.stableNoise = v;

	} );

	animate();

}

function setPause( v ) {

	mixerAction.paused = v;
	params.pause = v;
	if ( v ) {

		regenerateScene();

	}

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function regenerateScene() {

	pathTracer.bounces = params.bounces;
	pathTracer.setScene( scene, camera );

}

function animate() {

	requestAnimationFrame( animate );

	// step the animation forward
	const delta = Math.min( clock.getDelta(), 30 * 0.001 );
	mixer.update( delta );

	if ( params.autoPause ) {

		// auto pause the animation
		counter += delta;
		if ( ! params.pause && counter >= 2.5 || params.pause && counter >= 5 ) {

			setPause( ! params.pause );
			counter = 0;

		}

	} else {

		counter = 0;

	}

	pathTracer.dynamicLowRes = params.continuous;

	if ( ! params.pause && ! params.continuous ) {

		renderer.render( scene, camera );
		loader.setSamples( 0, pathTracer.isCompiling );

	} else {

		// if we're continuously path tracing then update the scene
		if ( ! params.pause && params.continuous ) {

			regenerateScene();

		}

		pathTracer.renderSample();
		loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

	}

}
