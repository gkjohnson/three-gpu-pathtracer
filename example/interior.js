import {
	ACESFilmicToneMapping,
	PerspectiveCamera,
	Box3,
	Vector3,
	EquirectangularReflectionMapping,
	Scene,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EquirectCamera, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { LoaderElement } from './utils/LoaderElement.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/pathtracing-bathroom/modernbathroom.glb';
const CREDITS = 'Interior scene by <a href="https://twitter.com/charlesforman">Charles Forman</a>';

let pathTracer, renderer, controls, sphericalControls, activeCamera, scene;
let camera, equirectCamera, loader;

const params = {

	environmentIntensity: 1,
	emissiveIntensity: 5,
	bounces: 20,
	renderScale: 1 / window.devicePixelRatio,
	tiles: 2,
	projection: 'Perspective',
	...getScaledSettings(),

};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.dynamicLowRes = true;
	pathTracer.filterGlossyFactor = 0.25;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	// camera
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0.4, 0.6, 2.65 );

	// Almost, but not quite on top of the control target.
	// This allows for full rotation without moving the camera very much.
	equirectCamera = new EquirectCamera();
	equirectCamera.position.set( - 0.2, 0.33, 0.08 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 0.33, - 0.08 );
	camera.lookAt( controls.target );
	controls.update();
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );

	sphericalControls = new OrbitControls( equirectCamera, renderer.domElement );
	sphericalControls.target.set( - 0.15, 0.33, - 0.08 );
	equirectCamera.lookAt( sphericalControls.target );
	sphericalControls.update();
	sphericalControls.addEventListener( 'change', () => pathTracer.updateCamera() );

	scene = new Scene();

	// load assets
	const [ envTexture, gltf ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL ),
	] );

	// set environment
	envTexture.mapping = EquirectangularReflectionMapping;
	scene.background = envTexture;
	scene.environment = envTexture;

	// set scene
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

	gltf.scene.position.addScaledVector( center, - 0.5 );

	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => loader.setPercentage( v ),
	} );

	loader.setCredits( CREDITS );

	onResize();
	onParamsChange();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const sceneFolder = gui.addFolder( 'Scene' );
	sceneFolder.add( params, 'projection', [ 'Perspective', 'Equirectangular' ] ).onChange( onParamsChange );
	sceneFolder.add( params, 'environmentIntensity', 0, 25 ).onChange( onParamsChange );
	sceneFolder.add( params, 'emissiveIntensity', 0, 50 ).onChange( onParamsChange );

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

		activeCamera = camera;

		sphericalControls.enabled = false;
		controls.enabled = true;
		controls.update();

	} else if ( projection === 'Equirectangular' ) {

		activeCamera = equirectCamera;

		controls.enabled = false;
		sphericalControls.enabled = true;
		sphericalControls.update();

	}

	scene.traverse( c => {

		const material = c.material;
		if ( material ) {

			material.emissiveIntensity = params.emissiveIntensity;

		}

	} );

	scene.environmentIntensity = params.environmentIntensity;
	scene.backgroundIntensity = params.environmentIntensity;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	pathTracer.setScene( scene, activeCamera );

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}




