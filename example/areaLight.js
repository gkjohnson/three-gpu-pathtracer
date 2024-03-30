import {
	ACESFilmicToneMapping,
	Box3,
	Color,
	CylinderGeometry,
	EquirectangularReflectionMapping,
	Group,
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

let pathTracer, controls, areaLights, scene, camera;
let samplesEl, loadingEl;
const params = {

	controls: true,

	areaLight1Enabled: true,
	areaLight1IsCircular: false,
	areaLight1Intensity: 2,
	areaLight1Color: '#ffffff',
	areaLight1Width: 1,
	areaLight1Height: 1,

	areaLight2Enabled: true,
	areaLight2IsCircular: false,
	areaLight2Intensity: 10,
	areaLight2Color: '#ff0000',
	areaLight2Width: 1.25,
	areaLight2Height: 2.75,

	environmentIntensity: 0.03,
	environmentRotation: 0,

	bounces: 5,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	multipleImportanceSampling: true

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.min( params.bounces, 10 );
	params.resolutionScale *= 0.5;
	params.tiles = 3;

}

init();

async function init() {

	const renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0.0, 0.6, 2.65 );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 0.33, - 0.08 );
	camera.lookAt( controls.target );
	controls.update();
	controls.addEventListener( 'change', () => {

		pathTracer.updateScene( camera, scene );

	} );

	camera.lookAt( - 0.15, 0.33, - 0.08 );

	samplesEl = document.getElementById( 'samples' );
	loadingEl = document.getElementById( 'loading' );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr' )
		.then( texture => {

			texture.mapping = EquirectangularReflectionMapping;

			scene.background = texture;
			scene.environment = texture;

		} );

	scene = new Scene();

	const group = new Group();
	scene.add( group );

	const floorGeom = new CylinderGeometry( 3.5, 3.5, 0.05, 60 );
	const floorMat = new MeshStandardMaterial( { color: new Color( 0x999999 ), metalness: 0.2, roughness: 0.02 } );
	const floor = new Mesh( floorGeom, floorMat );
	floor.position.y = - 0.025;
	group.add( floor );

	const box = new Box3();
	const gltf = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mercury-about-to-kill-argos/scene.glb' );

	gltf.scene.traverse( c => {

		if ( c.material ) c.material.map = null;

	} );

	gltf.scene.scale.setScalar( 0.01 );
	gltf.scene.position.x = 0.05;
	gltf.scene.updateMatrixWorld( true );

	box.setFromObject( gltf.scene );
	gltf.scene.position.y -= box.min.y;

	group.add( gltf.scene );
	group.updateMatrixWorld();

	const areaLight1 = new ShapedAreaLight( new Color( 0xFFFFFF ), 5.0, 1.0, 1.0 );
	areaLight1.position.x = 1.5;
	areaLight1.position.y = 1.0;
	areaLight1.position.z = - 0.5;
	areaLight1.rotateZ( - Math.PI / 4 );
	areaLight1.rotateX( - Math.PI / 2 );
	areaLight1.isCircular = false;
	group.add( areaLight1 );

	const areaLight2 = new ShapedAreaLight( new Color( 0xFF0000 ), 15.0, 1.25, 2.75 );
	areaLight2.position.y = 1.25;
	areaLight2.position.z = - 1.5;
	areaLight2.rotateX( Math.PI );
	areaLight2.isCircular = false;
	group.add( areaLight2 );

	areaLights = [ areaLight1, areaLight2 ];

	const generatorPromise = pathTracer.updateSceneAsync( camera, scene, {
		onProgress: v => {

			loadingEl.innerText = `Generating BVH ${ Math.round( 100 * v ) }%`;

		}
	} );

	await Promise.all( [ generatorPromise, envMapPromise ] );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( updateLights );
	ptFolder.add( params, 'bounces', 1, 15, 1 ).onChange( updateLights );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( onResize );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( updateLights );
	ptFolder.close();

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 3 ).onChange( updateLights );
	envFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( updateLights );
	envFolder.close();

	const areaLight1Folder = gui.addFolder( 'Area Light 1' );
	areaLight1Folder.add( params, 'areaLight1Enabled' ).name( 'enable' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1IsCircular' ).name( 'isCircular' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Intensity', 0, 200 ).name( 'intensity' ).onChange( updateLights );
	areaLight1Folder.addColor( params, 'areaLight1Color' ).name( 'color' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Width', 0, 5 ).name( 'width' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Height', 0, 5 ).name( 'height' ).onChange( updateLights );

	const areaLight2Folder = gui.addFolder( 'Area Light 2' );
	areaLight2Folder.add( params, 'areaLight2Enabled' ).name( 'enable' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2IsCircular' ).name( 'isCircular' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2Intensity', 0, 200 ).name( 'intensity' ).onChange( updateLights );
	areaLight2Folder.addColor( params, 'areaLight2Color' ).name( 'color' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2Width', 0, 5 ).name( 'width' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2Height', 0, 5 ).name( 'height' ).onChange( updateLights );

	updateLights();

	animate();

}

function updateLights() {

	areaLights[ 0 ].isCircular = params.areaLight1IsCircular;
	areaLights[ 0 ].intensity = params.areaLight1Intensity;
	areaLights[ 0 ].width = params.areaLight1Width;
	areaLights[ 0 ].height = params.areaLight1Height;
	areaLights[ 0 ].color.set( params.areaLight1Color ).convertSRGBToLinear();
	areaLights[ 0 ].visible = params.areaLight1Enabled;

	areaLights[ 1 ].isCircular = params.areaLight2IsCircular;
	areaLights[ 1 ].intensity = params.areaLight2Intensity;
	areaLights[ 1 ].width = params.areaLight2Width;
	areaLights[ 1 ].height = params.areaLight2Height;
	areaLights[ 1 ].color.set( params.areaLight2Color ).convertSRGBToLinear();
	areaLights[ 1 ].visible = params.areaLight2Enabled;

	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.resolutionScale;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;

	scene.environmentRotation.y = params.environmentRotation;
	scene.backgroundRotation.y = params.environmentRotation;
	scene.environmentIntensity = params.environmentIntensity;
	scene.backgroundIntensity = params.environmentIntensity;

	pathTracer.updateScene( camera, scene );

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	pathTracer.setSize( w, h );
	pathTracer.setPixelRatio( dpr );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	pathTracer.updateScene( camera, scene );

}

function animate() {

	requestAnimationFrame( animate );

	camera.updateMatrixWorld();
	pathTracer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}
