import {
	ACESFilmicToneMapping,
	Scene,
	BoxGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshStandardMaterial,
	WebGLRenderer,
	Color,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, PhysicalSpotLight, FogVolumeMaterial, WebGLPathTracer } from '../src/index.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';

let pathTracer, renderer, controls;
let camera, scene, fogMaterial, spotLight;
let loader;

const params = {

	multipleImportanceSampling: true,
	tiles: 2,
	renderScale: 1 / window.devicePixelRatio,

	color: '#eeeeee',
	fog: true,
	density: 0.01,
	lightIntensity: 500,
	lightColor: '#ffffff',

	bounces: 10,

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

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	camera.position.set( 0, 1, 6 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();

	} );

	// scene
	scene = new Scene();
	scene.background = new Color( 0 );

	fogMaterial = new FogVolumeMaterial();

	const material = new MeshStandardMaterial( { color: 0x999999, roughness: 1, metalness: 0 } );
	const fogMesh = new Mesh( new BoxGeometry( 8, 4.05, 8 ), fogMaterial );
	const floor = new Mesh( new CylinderGeometry( 5, 5, 0.1, 40 ), material );
	floor.position.y = - 1.1;

	// prepare light
	spotLight = new PhysicalSpotLight();
	spotLight.position.set( 0, 1, 0 ).multiplyScalar( 3 );
	spotLight.angle = Math.PI / 4.5;
	spotLight.decay = 2;
	spotLight.penumbra = 0.15;
	spotLight.distance = 0.0;
	spotLight.intensity = 50.0;
	spotLight.radius = 0.05;

	// prepare slats
	const group = new Group();
	group.add( spotLight );

	const TOTAL_SLATS = 10;
	const WIDTH = 2.0;
	const slat = new Mesh( new BoxGeometry( 0.1, 0.1, 2 ), material );
	for ( let i = 0; i < TOTAL_SLATS; i ++ ) {

		const s = slat.clone();
		s.position.x = - WIDTH * 0.5 + WIDTH * i / ( TOTAL_SLATS - 1 );
		s.position.y = 2;
		group.add( s );

	}

	scene.add( fogMesh, floor, group );
	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	onParamsChange();
	onResize();

	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'bounces', 1, 20, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const fogFolder = gui.addFolder( 'Fog' );
	fogFolder.addColor( params, 'color' ).onChange( onParamsChange );
	fogFolder.add( params, 'density', 0, 1 ).onChange( onParamsChange );

	const lightFolder = gui.addFolder( 'Spot Light' );
	lightFolder.add( params, 'lightIntensity', 0, 1000 ).onChange( onParamsChange );
	lightFolder.addColor( params, 'lightColor' ).onChange( onParamsChange );

	animate();

}

function onParamsChange() {

	fogMaterial.color.set( params.color ).convertSRGBToLinear();
	fogMaterial.density = params.density;

	spotLight.intensity = params.lightIntensity;
	spotLight.color.set( params.lightColor );

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	pathTracer.updateLights();
	pathTracer.updateMaterials();

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



