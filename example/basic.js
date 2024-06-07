import {
	ACESFilmicToneMapping,
	Scene,
	EquirectangularReflectionMapping,
	WebGLRenderer,
	PerspectiveCamera,
	CubeTextureLoader,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { WebGLPathTracer } from '..';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = 'Simple path tracing example scene setup with background blur.';

let pathTracer, renderer, controls;
let camera, scene;
let loader;

init();

async function init() {

	const { tiles, renderScale } = getScaledSettings();

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.renderScale = renderScale;
	pathTracer.tiles.set( tiles, tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	// camera
	camera = new PerspectiveCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.05;

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 10;
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// load the appropriate env
	let envPromise;
	if ( window.location.hash.includes( 'cube' ) ) {

		const path = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/SwedishRoyalCastle/';
		const format = '.jpg';
		const envUrls = [
			path + 'px' + format, path + 'nx' + format,
			path + 'py' + format, path + 'ny' + format,
			path + 'pz' + format, path + 'nz' + format
		];
		envPromise = new CubeTextureLoader().loadAsync( envUrls );

		scene.environmentIntensity = 5;
		scene.backgroundIntensity = 5;

	} else {

		envPromise = new RGBELoader().loadAsync( ENV_URL ).then( tex => {

			tex.mapping = EquirectangularReflectionMapping;
			return tex;

		} );

	}

	// load the environment map and model
	const [ gltf, envTexture ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		envPromise,
	] );

	scene.background = envTexture;
	scene.environment = envTexture;
	scene.add( gltf.scene );

	// initialize the path tracer
	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => loader.setPercentage( v ),
	} );

	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

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

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
