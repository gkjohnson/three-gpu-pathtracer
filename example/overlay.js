import {
	ACESFilmicToneMapping,
	Box3,
	BoxGeometry,
	Color,
	CylinderGeometry,
	EquirectangularReflectionMapping,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';

const ENV_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/sd-macross-city-standoff-diorama/scene.glb';
const CREDITS = 'Model by tipatat on Sketchfab';

let pathTracer, renderer, controls, scene, camera;
let overlayScene, floatingObjects;
let loader;

const params = {

	// path tracer settings
	bounces: 5,
	renderScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	multipleImportanceSampling: true,

	enabled: true,

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
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	// camera
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 2.996, 3.795, 0.697 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0.311, 1.13, 0.489 );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// init scene
	scene = new Scene();

	// init overlayScene
	overlayScene = new Scene();

	// load the assets
	const [ envTexture, gltf ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL )
	] );

	// update the env map
	envTexture.mapping = EquirectangularReflectionMapping;
	scene.background = envTexture;
	scene.environment = envTexture;

	// position the model
	const box = new Box3();
	gltf.scene.traverse( c => {

		if ( c.material ) c.material.map = null;

	} );

	gltf.scene.updateMatrixWorld( true );
	box.setFromObject( gltf.scene );
	gltf.scene.position.y -= box.min.y;
	scene.add( gltf.scene );

	// set the floor
	const floorGeom = new CylinderGeometry( 3.5, 3.5, 0.05, 60 );
	const floorMat = new MeshStandardMaterial( { color: new Color( 0x999999 ), metalness: 0.2, roughness: 0.02 } );
	const floor = new Mesh( floorGeom, floorMat );
	floor.position.y = - 0.025;
	scene.add( floor );

	// set floating Objects
	floatingObjects = [];
	const sampleMesh = new Mesh( new CylinderGeometry( 0.5, 0.5, 0.5, 32 ), new MeshBasicMaterial( { color: 0xff0000 } ) );
	const sampleMesh2 = new Mesh( new BoxGeometry( 0.3, 0.3, 0.3 ), new MeshBasicMaterial( { color: 0x00ff00 } ) );
	sampleMesh.position.set( - 1, 0, 1 );
	sampleMesh2.position.set( 1, 0, - 1 );
	floatingObjects.push( sampleMesh, sampleMesh2 );
	overlayScene.add( sampleMesh, sampleMesh2 );

	// initialize scene
	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => {

			loader.setPercentage( v );

		}
	} );

	loader.setCredits( CREDITS );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'bounces', 1, 15, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.close();

	onParamsChange();
	onResize();
	window.addEventListener( 'resize', onResize );

	animate();

}

function onParamsChange() {

	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

// it's a dummy material for rendering depth only
const depthMaterial = new MeshBasicMaterial( { colorWrite: false } );

function updateFloatingObjects() {

	for ( let i = 0; i < floatingObjects.length; i ++ ) {

		const obj = floatingObjects[ i ];
		// controlled y value by sin value
		obj.position.y = Math.sin( Date.now() * 0.001 + i );

	}

}

function animate() {

	requestAnimationFrame( animate );

	updateFloatingObjects();
	pathTracer.renderSample();

	const originAutoClear = renderer.autoClear;
	renderer.autoClear = false;
	scene.overrideMaterial = depthMaterial;
	renderer.clearDepth();
	// render depth of the scene
	renderer.render( scene, camera );
	scene.overrideMaterial = null;

	// render real time floating objects
	renderer.render( overlayScene, camera );
	renderer.autoClear = originAutoClear;

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
