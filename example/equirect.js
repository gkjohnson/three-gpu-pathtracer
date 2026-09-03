import {
	ACESFilmicToneMapping,
	PerspectiveCamera,
	Box3,
	Vector3,
	Color,
	Scene,
	WebGPURenderer,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EquirectCamera } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getScaledSettings } from './src/getScaledSettings.js';
import { LoaderElement } from './src/LoaderElement.js';
import { convertEmissivePlanesToLights } from './modelList.js';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/bitterli-rendering-resources/white-room.glb';
const CREDITS = 'Model by "Jay-Artist", from <a href="https://benedikt-bitterli.me/resources/">Benedikt Bitterli\'s rendering resources</a>';

let pathTracer, renderer, controls, sphericalControls, activeCamera, scene;
let camera, equirectCamera, loader;

const params = {

	bounces: 15,
	renderScale: 1,
	tiles: 2,
	projection: 'Equirectangular',
	...getScaledSettings(),

};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGPURenderer( { antialias: true } );
	renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.dynamicLowRes = true;
	pathTracer.tiles.set( params.tiles, params.tiles );

	// cameras, positioned once the scene's authored viewpoint is available
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	equirectCamera = new EquirectCamera();

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );

	sphericalControls = new OrbitControls( equirectCamera, renderer.domElement );
	sphericalControls.addEventListener( 'change', () => pathTracer.updateCamera() );

	scene = new Scene();
	scene.background = new Color( 0xffffff );

	// load assets
	const dracoLoader = new DRACOLoader();
	const gltf = await new GLTFLoader().setDRACOLoader( dracoLoader ).setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL );
	dracoLoader.dispose();

	// set scene
	convertEmissivePlanesToLights( gltf.scene );
	gltf.scene.traverse( c => {

		if ( c.material ) {

			// set the thickness so volume rendering is used for transmissive objects.
			c.material.thickness = 1.0;

		}

	} );

	scene.add( gltf.scene );
	scene.updateMatrixWorld();

	const box = new Box3();
	box.setFromObject( gltf.scene );

	const center = new Vector3();
	box.getCenter( center );

	// frame the viewpoint authored in the scene
	let sceneCamera = null;
	gltf.scene.traverse( c => {

		if ( ! sceneCamera && c.isPerspectiveCamera ) sceneCamera = c;

	} );

	camera.fov = sceneCamera.fov;
	camera.updateProjectionMatrix();
	camera.position.setFromMatrixPosition( sceneCamera.matrixWorld );
	const forward = new Vector3( 0, 0, - 1 ).transformDirection( sceneCamera.matrixWorld );
	controls.target.copy( camera.position ).addScaledVector( forward, 3 );
	controls.update();

	// Almost, but not quite on top of the control target.
	// This allows for full rotation without moving the camera very much.
	equirectCamera.position.copy( center );
	sphericalControls.target.copy( center ).addScaledVector( forward, 0.05 );
	sphericalControls.update();

	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	onResize();
	onParamsChange();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	gui.add( params, 'bounces', 1, 50, 1 ).onChange( onParamsChange );
	gui.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );
	gui.add( params, 'projection', [ 'Perspective', 'Equirectangular' ] ).onChange( onParamsChange );

	animate();

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function onParamsChange() {

	const projection = params.projection;
	if ( projection === 'Perspective' ) {

		// the perspective view is locked to the scene's authored viewpoint
		activeCamera = camera;

		sphericalControls.enabled = false;
		controls.enabled = false;

	} else if ( projection === 'Equirectangular' ) {

		activeCamera = equirectCamera;

		controls.enabled = false;
		sphericalControls.enabled = true;
		sphericalControls.update();

	}

	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	pathTracer.setScene( scene, activeCamera );

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	pathTracer.getSampleCountsAsync().then( counts => loader.setSamples( counts ) );

}




