import { ACESFilmicToneMapping, Scene, EquirectangularReflectionMapping, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';

let pathTracer, controls, camera, scene, samplesEl;

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
	const renderer = new WebGLRenderer( { antialias: true } );
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.toneMapping = ACESFilmicToneMapping;
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.renderScale = resolutionScale;
	pathTracer.setClearColor( 0, 0 );
	pathTracer.tiles.set( tiles, tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
	document.body.appendChild( pathTracer.domElement );

	camera = new PhysicalCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	controls = new OrbitControls( camera, pathTracer.domElement );
	controls.target.y = 10;
	controls.update();

	scene = new Scene();
	scene.backgroundBlurriness = 0.05;

	controls.addEventListener( 'change', () => {

		pathTracer.updateScene( camera, scene );

	} );

	// load the envmap and model
	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr' )
		.then( texture => {

			texture.mapping = EquirectangularReflectionMapping;
			scene.background = texture;
			scene.environment = texture;

		} );

	const gltfPromise = new GLTFLoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf' )
		.then( gltf => {

			scene.add( gltf.scene );

		} );

	// wait for the scene to be rady
	await Promise.all( [ gltfPromise, envMapPromise ] );

	await pathTracer.updateSceneAsync( camera, scene );

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

	pathTracer.setSize( w, h );
	pathTracer.setPixelRatio( dpr );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	pathTracer.updateScene( camera, scene );

}

function animate() {

	requestAnimationFrame( animate );
	pathTracer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}
