import {
	AgXToneMapping,
	PerspectiveCamera,
	Scene,
	Box3,
	Mesh,
	CylinderGeometry,
	MeshPhysicalMaterial,
	WebGLRenderer,
	EquirectangularReflectionMapping,
	Color,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { getScaledSettings } from './utils/getScaledSettings.js';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/material-balls/material_ball_v2.glb';
const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/autoshop_01_1k.hdr';
const DB_URL = 'https://api.physicallybased.info/materials';
const CREDITS = 'Materials courtesy of "physicallybased.info"';

let pathTracer, renderer, controls, shellMaterial;
let camera, database, scene;
let loader, imgEl;

const params = {
	material: null,
	tiles: 2,
	bounces: 5,
	multipleImportanceSampling: true,
	renderScale: 1 / window.devicePixelRatio,
	...getScaledSettings(),
};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	imgEl = document.getElementById( 'materialImage' );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = AgXToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.filterGlossyFactor = 0.5;

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PerspectiveCamera( 75, aspect, 0.025, 500 );
	camera.position.set( - 4, 2, 3 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );

	// scene
	scene = new Scene();

	// load assets
	const [ envTexture, gltf, dbJson ] = await Promise.all( [
		new RGBELoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL ),
		fetch( DB_URL ).then( res => res.json() ),
	] );

	// background
	envTexture.mapping = EquirectangularReflectionMapping;
	scene.background = envTexture;
	scene.environment = envTexture;

	// scene initialization
	gltf.scene.scale.setScalar( 0.01 );
	gltf.scene.updateMatrixWorld();
	scene.add( gltf.scene );

	const box = new Box3();
	box.setFromObject( gltf.scene );

	const floor = new Mesh(
		new CylinderGeometry( 3, 3, 0.05, 200 ),
		new MeshPhysicalMaterial( { color: 0xffffff, roughness: 0, metalness: 0.25 } ),
	);
	floor.geometry = floor.geometry.toNonIndexed();
	floor.geometry.clearGroups();
	floor.position.y = box.min.y - 0.03;
	scene.add( floor );

	shellMaterial = new MeshPhysicalMaterial();
	const coreMaterial = new MeshPhysicalMaterial( { color: new Color( 0.5, 0.5, 0.5 ) } );
	gltf.scene.traverse( c => {

		// the vertex normals on the material ball are off...
		// TODO: precompute the vertex normals so they are correct on load
		if ( c.geometry ) {

			c.geometry.computeVertexNormals();

		}

		if ( c.name === 'Sphere_1' ) {

			c.material = coreMaterial;

		} else {

			c.material = shellMaterial;

		}

		if ( c.name === 'subsphere_1' ) {

			c.material = coreMaterial;

		}

	} );

	// database set up
	database = {};
	dbJson.forEach( mat => database[ mat.name ] = mat );
	params.material = Object.keys( database )[ 0 ];

	// initialize scene
	pathTracer.setScene( scene, camera );
	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	onParamsChange();
	onResize();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	gui.add( params, 'material', Object.keys( database ) ).onChange( onParamsChange );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	animate();

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	pathTracer.updateCamera();

}

function applyMaterialInfo( info, material ) {

	material.color.set( 0xffffff );
	material.transmission = 0.0;
	material.attenuationDistance = Infinity;
	material.attenuationColor.set( 0xffffff );
	material.specularColor.set( 0xffffff );
	material.metalness = 0.0;
	material.roughness = 1.0;
	material.ior = 1.5;
	material.thickness = 1.0;
	material.iridescence = 0.0;
	material.iridescenceIOR = 1.0;
	material.iridescenceThicknessRange = [ 0, 0 ];

	if ( info.specularColor ) material.specularColor.setRGB( ...info.specularColor );
	if ( 'metalness' in info ) material.metalness = info.metalness;
	if ( 'roughness' in info ) material.roughness = info.roughness;
	if ( 'ior' in info ) material.ior = info.ior;
	if ( 'transmission' in info ) material.transmission = info.transmission;
	if ( 'thinFilmThickness' in info ) {

		material.iridescence = 1.0;
		material.iridescenceIOR = info.thinFilmIor;
		material.iridescenceThicknessRange = [ info.thinFilmThickness, info.thinFilmThickness ];

	}

	if ( material.transmission ) {

		if ( info.color ) material.attenuationColor.setRGB( ...info.color );
		material.attenuationDistance = 200 / info.density;

	} else {

		if ( info.color ) material.color.setRGB( ...info.color );

	}

	imgEl.src = info.reference[ 0 ];

}

function onParamsChange() {

	applyMaterialInfo( database[ params.material ], shellMaterial );

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.renderScale = params.renderScale;
	pathTracer.bounces = params.bounces;
	pathTracer.updateMaterials();

}

function animate() {

	requestAnimationFrame( animate );
	pathTracer.renderSample();
	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
