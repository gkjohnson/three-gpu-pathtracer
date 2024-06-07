import {
	ACESFilmicToneMapping,
	Box3,
	Color,
	CylinderGeometry,
	EquirectangularReflectionMapping,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ShapedAreaLight, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mercury-about-to-kill-argos/scene.glb';
const CREDITS = 'Model courtesy of Virtual Museums of Małopolska';

let pathTracer, renderer, controls, areaLight, scene, camera;
let loader;

const params = {

	// area light settings
	enabled: true,
	isCircular: false,
	intensity: 2,
	color: '#ffffff',
	width: 1,
	height: 1,

	// path tracer settings
	bounces: 5,
	renderScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	multipleImportanceSampling: true,

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
	camera.position.set( 0.0, 0.6, 2.65 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 0.33, - 0.08 );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// init scene
	scene = new Scene();
	scene.environmentIntensity = 0.03;
	scene.backgroundIntensity = 0.03;

	// load the assets
	const [ envTexture, gltf ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL ),
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

	gltf.scene.scale.setScalar( 0.01 );
	gltf.scene.position.x = 0.05;
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

	// initialize lights
	areaLight = new ShapedAreaLight( new Color( 0xffffff ), 5.0, 1.0, 1.0 );
	areaLight.position.x = 1.5;
	areaLight.position.y = 1.0;
	areaLight.position.z = - 0.5;
	areaLight.rotateZ( - Math.PI / 4 );
	areaLight.rotateX( - Math.PI / 2 );
	areaLight.isCircular = false;
	scene.add( areaLight );

	const redLight = new ShapedAreaLight( new Color( 0xff0000 ), 15.0, 1.25, 2.75 );
	redLight.position.y = 1.25;
	redLight.position.z = - 1.5;
	redLight.rotateX( Math.PI );
	redLight.isCircular = false;
	scene.add( redLight );

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

	const areaLightFolder = gui.addFolder( 'Area Light' );
	areaLightFolder.add( params, 'enabled' ).name( 'enable' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'isCircular' ).name( 'isCircular' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'intensity', 0, 200 ).name( 'intensity' ).onChange( onParamsChange );
	areaLightFolder.addColor( params, 'color' ).name( 'color' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'width', 0, 5 ).name( 'width' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'height', 0, 5 ).name( 'height' ).onChange( onParamsChange );

	onParamsChange();
	onResize();
	window.addEventListener( 'resize', onResize );

	animate();

}

function onParamsChange() {

	areaLight.isCircular = params.isCircular;
	areaLight.intensity = params.intensity;
	areaLight.width = params.width;
	areaLight.height = params.height;
	areaLight.color.set( params.color ).convertSRGBToLinear();
	areaLight.visible = params.enabled;

	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;

	pathTracer.updateLights();

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

	pathTracer.renderSample();

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
