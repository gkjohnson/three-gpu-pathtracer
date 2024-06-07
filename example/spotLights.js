import {
	WebGLRenderer,
	ACESFilmicToneMapping,
	PCFSoftShadowMap,
	Scene,
	EquirectangularReflectionMapping,
	Box3,
	Mesh,
	CylinderGeometry,
	MeshStandardMaterial,
	BoxGeometry,
	PerspectiveCamera,
} from 'three';
import { IESLoader } from 'three/examples/jsm/loaders/IESLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalSpotLight, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/steampunk-robot/scene.gltf';
const ENV_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr';
const CREDITS = 'Model by Benedict Chew on Sketchfab';
const IES_PROFILE_URLS = [
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/0646706b3d2d9658994fc4ad80681dec.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/06b4cfdc8805709e767b5e2e904be8ad.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/007cfb11e343e2f42e3b476be4ab684e.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/01dac7d6c646814dcda6780e7b7b4566.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/108b32f07d6d38a7a6528a6d307440df.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/1aec5958092c236d005093ca27ebe378.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/02a7562c650498ebb301153dbbf59207.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/1a936937a49c63374e6d4fbed9252b29.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/00c6ce79e1d2cdf3a1fb491aaaa47ae0.ies',
];

let pathTracer, renderer, controls;
let scene, camera, spotLight, iesTextures;
let loader;

// gui parameters
const params = {
	multipleImportanceSampling: true,
	bounces: 3,
	renderScale: 1 / window.devicePixelRatio,
	tiles: 2,
	iesProfile: - 1,
	...getScaledSettings(),
};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer();
	renderer.shadowMap.enabled = true;
	renderer.physicallyCorrectLights = true;
	renderer.shadowMap.type = PCFSoftShadowMap;
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.textureSize.set( 2048, 2048 );
	pathTracer.filterGlossyFactor = 0.5;

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PerspectiveCamera( 75, aspect, 0.025, 500 );
	camera.position.set( - 2, 4, 8 ).multiplyScalar( 0.8 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 1.5;
	controls.update();
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.1;
	scene.environmentIntensity = 0.1;
	scene.backgroundIntensity = 0.1;

	// load assets
	const iesLoader = new IESLoader();
	const [ envTexture, gltf, textures ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().loadAsync( MODEL_URL ),
		Promise.all( IES_PROFILE_URLS.map( url => iesLoader.loadAsync( url ) ) )
	] );

	// ies textures
	iesTextures = textures;

	// environment
	envTexture.mapping = EquirectangularReflectionMapping;
	scene.environment = envTexture;
	scene.background = envTexture;

	// objects
	gltf.scene.scale.setScalar( 1 );
	gltf.scene.updateMatrixWorld();
	gltf.scene.traverse( c => {

		c.castShadow = true;
		c.receiveShadow = true;

	} );
	scene.add( gltf.scene );

	const box = new Box3();
	box.setFromObject( gltf.scene );

	// init environment
	const floor = new Mesh(
		new CylinderGeometry( 8, 8, 0.5, 200 ),
		new MeshStandardMaterial( { color: 0x555555, roughness: 0.05, metalness: 0.4 } ),
	);
	floor.geometry = floor.geometry.toNonIndexed();
	floor.geometry.clearGroups();
	floor.position.y = box.min.y - 0.25;
	floor.receiveShadow = true;
	floor.material.color.convertSRGBToLinear();
	scene.add( floor );

	const wall = new Mesh(
		new BoxGeometry( 14, 6, 0.5 ),
		new MeshStandardMaterial( { color: 0xa06464, roughness: 0.4, metalness: 0.1 } ),
	);
	wall.castShadow = true;
	wall.receiveShadow = true;
	wall.geometry = wall.geometry.toNonIndexed();
	wall.geometry.clearGroups();
	wall.position.x = 0.0;
	wall.position.y = box.min.y + 3;
	wall.position.z = box.min.z - 0.5;
	wall.material.color.convertSRGBToLinear();
	scene.add( wall );

	// spot light
	spotLight = new PhysicalSpotLight( 0xffffff );
	spotLight.position.set( 0, 7.0, 4 );
	spotLight.angle = Math.PI / 4.5;
	spotLight.decay = 0;
	spotLight.penumbra = 1.0;
	spotLight.distance = 0.0;
	spotLight.intensity = 50.0;
	spotLight.radius = 0.5;

	// spot light shadow
	spotLight.shadow.mapSize.width = 512;
	spotLight.shadow.mapSize.height = 512;
	spotLight.shadow.camera.near = 0.1;
	spotLight.shadow.camera.far = 10.0;
	spotLight.shadow.focus = 1.0;
	spotLight.castShadow = true;
	scene.add( spotLight );

	// spot light target
	const targetObject = spotLight.target;
	targetObject.position.x = 0;
	targetObject.position.y = floor.position.y + 2;
	targetObject.position.z = 0.05;
	scene.add( targetObject );

	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => loader.setPercentage( v ),
	} );

	loader.setCredits( CREDITS );
	onParamsChange();
	onResize();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onResize );

	const lightFolder = gui.addFolder( 'Spot Light' );
	lightFolder.addColor( spotLight, 'color' ).onChange( onParamsChange );
	lightFolder.add( spotLight, 'intensity', 0.0, 200.0, 0.01 ).onChange( onParamsChange );
	lightFolder.add( spotLight, 'radius', 0.0, 10.0 ).onChange( onParamsChange );
	lightFolder.add( spotLight, 'decay', 0.0, 2.0 ).onChange( onParamsChange );
	lightFolder.add( spotLight, 'distance', 0.0, 20.0 ).onChange( onParamsChange );
	lightFolder.add( spotLight, 'angle', 0.0, Math.PI / 2.0 ).onChange( onParamsChange );
	lightFolder.add( spotLight, 'penumbra', 0.0, 1.0 ).onChange( onParamsChange );
	lightFolder.add( params, 'iesProfile', - 1, IES_PROFILE_URLS.length - 1, 1 ).onChange( v => {

		spotLight.iesMap = v === - 1 ? null : iesTextures[ v ];
		onParamsChange();

	} );

	animate();

}

function onResize() {

	// TODO: we need to handle the interpolation of the float texture more intelligently to avoid
	// extra bright hot spots - then this can be moved to "onParamsChange"
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio * params.renderScale );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	pathTracer.updateCamera();

}

function onParamsChange() {

	// pathTracer.renderScale = params.renderScale;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.bounces = params.bounces;
	pathTracer.updateLights();

}

function animate() {

	requestAnimationFrame( animate );

	camera.updateMatrixWorld();
	pathTracer.renderSample();
	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
