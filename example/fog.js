import { ACESFilmicToneMapping, Scene } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, PhysicalSpotLight, FogVolumeMaterial, WebGLPathTracer } from '../src/index.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';

let renderer, controls;
let camera, scene, fogMaterial, spotLight;
let samplesEl;

const params = {

	enable: true,
	pause: false,
	mis: true,
	tiles: 2,
	resolutionScale: 1 / window.devicePixelRatio,

	color: '#eeeeee',
	fog: true,
	density: 0.01,
	lightIntensity: 500,
	lightColor: '#ffffff',

	bounces: 10,

};

init();

async function init() {

	renderer = new WebGLPathTracer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.setClearColor( 0, 0 );
	renderer.tiles.set( params.tiles, params.tiles );
	renderer.setBVHWorker( new ParallelMeshBVHWorker() );
	renderer.setClearColor( 0, 1 );
	document.body.appendChild( renderer.domElement );

	const aspect = window.innerWidth / window.innerHeight;
	camera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	camera.position.set( 0, 1, 6 );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		renderer.reset();

	} );

	scene = new Scene();

	samplesEl = document.getElementById( 'samples' );
	fogMaterial = new FogVolumeMaterial();

	const envMat = new MeshStandardMaterial( { color: 0x999999, roughness: 1, metalness: 0 } );
	const fogMesh = new Mesh( new BoxGeometry( 8, 4.05, 8 ), fogMaterial );
	const floor = new Mesh( new CylinderGeometry( 5, 5, 0.1, 40 ), envMat );
	floor.position.y = - 1.1;

	spotLight = new PhysicalSpotLight();
	spotLight.position.set( 0, 1, 0 ).multiplyScalar( 3 );
	spotLight.angle = Math.PI / 4.5;
	spotLight.decay = 2;
	spotLight.penumbra = 0.15;
	spotLight.distance = 0.0;
	spotLight.intensity = 50.0;
	spotLight.radius = 0.05;

	const lightGroup = new Group();
	lightGroup.add( spotLight );

	const TOTAL_SLATS = 10;
	const WIDTH = 2.0;
	const slat = new Mesh( new BoxGeometry( 0.1, 0.1, 2 ), envMat );
	for ( let i = 0; i < TOTAL_SLATS; i ++ ) {

		const s = slat.clone();
		s.position.x = - WIDTH * 0.5 + WIDTH * i / ( TOTAL_SLATS - 1 );
		s.position.y = 2;
		lightGroup.add( s );

	}

	const group = new Group();
	group.add( fogMesh, floor, lightGroup );
	scene.add( group );

	group.updateMatrixWorld();
	await renderer.updateSceneAsync( camera, scene );

	onResize();
	reset();

	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'enable' );
	ptFolder.add( params, 'pause' );
	ptFolder.add( params, 'bounces', 1, 20, 1 ).onChange( reset );
	ptFolder.add( params, 'mis' ).onChange( reset );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		renderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( reset );

	const fogFolder = gui.addFolder( 'fog' );
	fogFolder.addColor( params, 'color' ).onChange( reset );
	fogFolder.add( params, 'density', 0, 1 ).onChange( reset );

	const lightFolder = gui.addFolder( 'light' );
	lightFolder.add( params, 'lightIntensity', 0, 1000 ).onChange( reset );
	lightFolder.addColor( params, 'lightColor' ).onChange( reset );

	animate();

}

function reset() {

	fogMaterial.color.set( params.color ).convertSRGBToLinear();
	fogMaterial.density = params.density;

	spotLight.intensity = params.lightIntensity;
	spotLight.color.set( params.lightColor );

	renderer.renderScale = params.resolutionScale;
	renderer.multipleImportanceSampling = renderer.multipleImportanceSampling;
	renderer.bounces = params.bounces;
	renderer.updateScene( camera, scene );

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	renderer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	camera.updateMatrixWorld();
	renderer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( renderer.samples ) }`;

}




