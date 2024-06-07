import {
	Vector2,
	Vector3,
	ACESFilmicToneMapping,
	Scene,
	SphereGeometry,
	MeshStandardMaterial,
	Mesh,
	Raycaster,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, BlurredEnvMapGenerator, GradientEquirectTexture, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';

const ENV_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/sd-macross-city-standoff-diorama/scene.glb';
const CREDITS = 'Model by tipatat on Sketchfab';
const DESCRIPTION = 'Path tracing with configurable bokeh and depth of field. Click point in scene to focus.';

let pathTracer, renderer, controls, camera, scene, bvh;
let loader;
const mouse = new Vector2();
const focusPoint = new Vector3();
const params = {

	bounces: 3,
	renderScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	autoFocus: true,

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
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
	pathTracer.tiles.set( params.tiles, params.tiles );

	// camera
	camera = new PhysicalCamera( 60, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( - 0.262, 0.5276, - 1.1606 );
	camera.apertureBlades = 6;
	camera.fStop = 0.6;
	camera.focusDistance = 1.1878;
	focusPoint.set( - 0.5253353217832674, 0.3031596413506029, 0.000777794185259223 );

	// background
	const gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( 0x390f20 ).convertSRGBToLinear();
	gradientMap.bottomColor.set( 0x151b1f ).convertSRGBToLinear();
	gradientMap.update();

	// scene
	scene = new Scene();
	scene.background = gradientMap;
	scene.environmentIntensity = 0.5;

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.182, 0.147, 0.06 );
	controls.update();
	controls.addEventListener( 'change', () => {

		if ( params.autoFocus ) {

			camera.focusDistance = camera.position.distanceTo( focusPoint ) - camera.near;

		}

		pathTracer.updateCamera();

	} );

	const [ envTexture, gltf ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL )
	] );

	// set up environment map
	const generator = new BlurredEnvMapGenerator( renderer );
	const blurredTex = generator.generate( envTexture, 0.35 );
	generator.dispose();
	envTexture.dispose();

	scene.environment = blurredTex;

	// create bright points around the scene
	const geometry = new SphereGeometry( 1, 10, 10 );
	const mat = new MeshStandardMaterial( { emissiveIntensity: 10, emissive: 0xffffff } );
	for ( let i = 0; i < 300; i ++ ) {

		const m = new Mesh( geometry, mat );
		m.scale.setScalar( 0.075 * Math.random() + 0.03 );
		m.position.randomDirection().multiplyScalar( 30 + Math.random() * 15 );
		scene.add( m );

	}

	gltf.scene.scale.setScalar( 0.5 );
	gltf.scene.traverse( c => {

		if ( c.material ) {

			c.material.roughness = 0.05;
			c.material.metalness = 0.05;

		}

	} );
	scene.add( gltf.scene );
	scene.updateMatrixWorld( true );

	// update the scene
	const results = await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => loader.setPercentage( v ),
	} );
	bvh = results.bvh;

	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );
	onParamsChange();
	onResize();

	window.addEventListener( 'resize', onResize );
	renderer.domElement.addEventListener( 'mouseup', onMouseUp );
	renderer.domElement.addEventListener( 'mousedown', onMouseDown );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( camera, 'focusDistance', 1, 100 ).onChange( onParamsChange ).listen();
	cameraFolder.add( camera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		camera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		onParamsChange();


	} );
	cameraFolder.add( camera, 'apertureRotation', 0, 12.5 ).onChange( onParamsChange );
	cameraFolder.add( camera, 'anamorphicRatio', 0.1, 10.0 ).onChange( onParamsChange );
	cameraFolder.add( camera, 'bokehSize', 0, 100 ).onChange( onParamsChange ).listen();
	cameraFolder.add( camera, 'fStop', 0.02, 20 ).onChange( onParamsChange ).listen();
	cameraFolder.add( camera, 'fov', 25, 100 ).onChange( () => {

		camera.updateProjectionMatrix();
		pathTracer.updateCamera();

	} ).listen();
	cameraFolder.add( params, 'autoFocus' );

	animate();

}

// mouse events for focusing on clicked poin
function onMouseDown( e ) {

	mouse.set( e.clientX, e.clientY );

}

function onMouseUp( e ) {

	const deltaMouse = Math.abs( mouse.x - e.clientX ) + Math.abs( mouse.y - e.clientY );
	if ( deltaMouse < 2 && bvh ) {

		const raycaster = new Raycaster();
		raycaster.setFromCamera( {

			x: ( e.clientX / window.innerWidth ) * 2 - 1,
			y: - ( e.clientY / window.innerHeight ) * 2 + 1,

		}, camera );

		const hit = bvh.raycastFirst( raycaster.ray );
		if ( hit ) {

			focusPoint.copy( hit.point );
			camera.focusDistance = hit.distance - camera.near;
			pathTracer.updateCamera();

		}

	}

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function onParamsChange() {

	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	pathTracer.updateCamera();
	pathTracer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
