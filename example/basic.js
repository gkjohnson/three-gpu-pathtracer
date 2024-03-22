import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, WebGLPathTracer } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

let renderer, controls, camera, scene, samplesEl;

let tiles = 2;
let resolutionScale = Math.max( 1 / window.devicePixelRatio, 0.5 );

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	resolutionScale = 1 / window.devicePixelRatio;
	tiles = 3;

}

init();

async function init() {

	samplesEl = document.getElementById( 'samples' );

	// init renderer, camera, controls, scene
	renderer = new WebGLPathTracer();
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.filterGlossyFactor = 0.5;
	renderer.renderScale = resolutionScale; // TODO: causing dark outlines
	renderer.setClearColor( 0, 0 );
	renderer.tiles.set( tiles, tiles );
	document.body.appendChild( renderer.domElement );

	camera = new PhysicalCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 10;
	controls.update();

	scene = new THREE.Scene();
	scene.backgroundBlurriness = 0.05;

	controls.addEventListener( 'change', () => {

		renderer.reset();

	} );

	// load the envmap and model
	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr' )
		.then( texture => {

			texture.mapping = THREE.EquirectangularReflectionMapping;
			scene.background = texture;
			scene.environment = texture;

		} );

	const generator = new PathTracingSceneWorker();
	const gltfPromise = new GLTFLoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf' )
		.then( gltf => {

			return generator.generate( gltf.scene );

		} )
		.then( result => {

			scene.add( result.scene );

		} );

	// wait for the scene to be rady
	await Promise.all( [ gltfPromise, envMapPromise ] );

	renderer.updateScene( camera, scene );

	document.getElementById( 'loading' ).remove();
	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

function onResize() {

	// update rendering resolution
	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

}

function animate() {

	requestAnimationFrame( animate );
	renderer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( renderer.samples ) }`;

}
