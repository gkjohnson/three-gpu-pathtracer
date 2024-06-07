import {
	Scene,
	EquirectangularReflectionMapping,
	WebGLRenderer,
	PerspectiveCamera,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
	DoubleSide,
	Color,
	ACESFilmicToneMapping,
	NoToneMapping,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { WebGLPathTracer } from '..';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { HDRImageGenerator } from './utils/HDRImageGenerator.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getScaledSettings } from './utils/getScaledSettings.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/MER_static.glb';
const CREDITS = 'Model courtesy of NASA/Caltech-JPL';
const DESCRIPTION = window.matchMedia( '(dynamic-range: high)' ).matches ? 'HDR display supported' : 'HDR display not supported';

const MAX_SAMPLES = 45;

const params = {
	pause: false,
	hdr: true,
	sdrToneMapping: false,
	environmentIntensity: 15,
	tiles: 3,
	bounces: 5,
	renderScale: 1,

	...getScaledSettings(),
};

let pathTracer, renderer, controls;
let camera, scene;
let loader, hdrGenerator;
let activeImage = false;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.bounces = params.bounces;
	pathTracer.minSamples = 1;
	pathTracer.renderScale = params.renderScale;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	// generator
	hdrGenerator = new HDRImageGenerator( renderer, document.querySelector( 'img' ) );

	// camera
	camera = new PerspectiveCamera( 50, 1, 0.025, 500 );
	camera.position.set( 20, 24, 35 ).multiplyScalar( 0.8 );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.1;
	scene.background = new Color( 0x111111 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 6;
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();
		resetHdr();

	} );
	controls.update();

	// load the environment map and model
	const [ gltf, envTexture ] = await Promise.all( [
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL ),
		new RGBELoader().loadAsync( ENV_URL ),
	] );

	envTexture.mapping = EquirectangularReflectionMapping;
	scene.environment = envTexture;
	scene.environmentIntensity = params.environmentIntensity;

	const model = gltf.scene;
	model.scale.setScalar( 10 );
	scene.add( model );

	const floorTex = generateRadialFloorTexture( 2048 );
	const floorPlane = new Mesh(
		new PlaneGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0x111111,
			roughness: 0.1,
			metalness: 0.1,
			side: DoubleSide,
		} ),
	);
	floorPlane.scale.setScalar( 50 );
	floorPlane.rotation.x = - Math.PI / 2;
	scene.add( floorPlane );

	// initialize the path tracer
	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => loader.setPercentage( v ),
	} );

	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

	const gui = new GUI();
	gui.add( params, 'pause' ).onChange( () => {

		resetHdr();

	} );
	gui.add( params, 'hdr' );
	gui.add( params, 'sdrToneMapping' ).onChange( v => {

		renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;

	} );
	gui.add( params, 'renderScale', 0.1, 1 ).onChange( v => {

		pathTracer.renderScale = v;
		pathTracer.reset();
		resetHdr();

	} );
	gui.add( params, 'bounces', 1, 10 ).onChange( v => {

		pathTracer.bounces = v;
		pathTracer.reset();
		resetHdr();

	} );
	gui.add( params, 'tiles', 1, 6, 1 ).onChange( v => {

		pathTracer.tiles.setScalar( v );

	} );
	gui.add( params, 'environmentIntensity', 0, 30 ).onChange( v => {

		scene.environmentIntensity = v;
		pathTracer.updateEnvironment();
		resetHdr();

	} );

	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

function onResize() {

	// update resolution
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	// update camera
	pathTracer.updateCamera();

	resetHdr();

}

function resetHdr() {

	hdrGenerator.reset();
	activeImage = false;

}

function animate() {

	requestAnimationFrame( animate );

	const doPause = params.pause && pathTracer.samples >= 1;
	pathTracer.pausePathTracing = pathTracer.samples >= MAX_SAMPLES || doPause;
	pathTracer.renderSample();

	if (
		! hdrGenerator.encoding &&
		params.hdr &&
		( pathTracer.samples === MAX_SAMPLES || doPause ) &&
		! activeImage
	) {

		// NOTE: this can be called repeatedly but takes up to 200 ms
		hdrGenerator.updateFrom( pathTracer.target );
		activeImage = true;

	}

	if ( hdrGenerator.completeImage && params.hdr ) {

		hdrGenerator.image.classList.add( 'show' );

	} else {

		hdrGenerator.image.classList.remove( 'show' );

	}

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
