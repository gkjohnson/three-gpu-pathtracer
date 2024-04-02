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

const ENV_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/pathtracing-bathroom/modernbathroom.glb';

let pathTracer, renderer, controls, sphericalControls, activeCamera, scene;
let camera, equirectCamera;
let samplesEl;

const params = {

	environmentIntensity: 0,
	environmentRotation: 0,
	emissiveIntensity: 12,
	bounces: 20,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
	tiles: 2,
	cameraProjection: 'Perspective',
	...getScaledSettings(),

};

init();

async function init() {

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.dynamicLowRes = true;
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

	samplesEl = document.getElementById( 'samples' );

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

	await pathTracer.setSceneAsync( scene, camera );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'filterGlossyFactor', 0, 1 ).onChange( onParamsChange );
	gui.add( params, 'environmentIntensity', 0, 25 ).onChange( onParamsChange );
	gui.add( params, 'environmentRotation', 0, 40 ).onChange( onParamsChange );
	gui.add( params, 'emissiveIntensity', 0, 50 ).onChange( onParamsChange );
	gui.add( params, 'bounces', 1, 30, 1 ).onChange( onParamsChange );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( onParamsChange );
	gui.add( params, 'cameraProjection', [ 'Perspective', 'Equirectangular' ] ).onChange( onParamsChange );

	onParamsChange();

	animate();

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function updateIntensity() {


}

function onParamsChange() {

	updateIntensity();

	const cameraProjection = params.cameraProjection;
	if ( cameraProjection === 'Perspective' ) {

		activeCamera = camera;
		controls.object = activeCamera;

	}

	if ( cameraProjection === 'Equirectangular' ) {

		activeCamera = equirectCamera;

		controls.enabled = false;
		sphericalControls.enabled = true;

		sphericalControls.update();

	} else {

		sphericalControls.enabled = false;
		controls.enabled = true;

		controls.update();

	}

	scene.traverse( c => {

		const material = c.material;
		if ( material ) {

			material.emissiveIntensity = params.emissiveIntensity;

		}

	} );

	pathTracer.renderScale = params.resolutionScale;

	scene.environmentRotation.y = params.environmentRotation;
	scene.backgroundRotation.y = params.environmentRotation;
	scene.environmentIntensity = params.environmentIntensity;
	scene.backgroundIntensity = params.environmentIntensity;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;

	pathTracer.setScene( scene, activeCamera );

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}




