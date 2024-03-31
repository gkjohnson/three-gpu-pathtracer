import { ACESFilmicToneMapping, Scene, EquirectangularReflectionMapping, WebGLRenderer, PerspectiveCamera } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';

let pathTracer, renderer, controls, camera, scene, samplesEl;

init();

async function init() {

	const { tiles, renderScale } = getScaledSettings();

	samplesEl = document.getElementById( 'samples' );

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

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 10;
	controls.update();

	controls.addEventListener( 'change', () => {

		pathTracer.updateScene( camera, scene );

	} );

	// load the env map and model
	const [ gltf, envTexture ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		new RGBELoader().loadAsync( ENV_URL ),
	] );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.05;
	scene.add( gltf.scene );
	envTexture.mapping = EquirectangularReflectionMapping;
	scene.background = envTexture;
	scene.environment = envTexture;

	// initialize the path tracer
	await pathTracer.updateSceneAsync( camera, scene );

	document.getElementById( 'loading' ).remove();
	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

function onResize() {

	// update resolution
	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	// update camera
	pathTracer.updateScene( camera, scene );

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}
