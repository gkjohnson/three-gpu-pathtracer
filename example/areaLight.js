import {
	AgXToneMapping,
	Box3,
	Color,
	PerspectiveCamera,
	RectAreaLight,
	RectAreaLightNode,
	Scene,
	Vector3,
	WebGPURenderer,
} from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getScaledSettings } from './src/getScaledSettings.js';
import { LoaderElement } from './src/LoaderElement.js';
import { Backdrop } from './src/Backdrop.js';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mercury-about-to-kill-argos/scene.glb';
const CREDITS = 'Model courtesy of Virtual Museums of Małopolska';

let pathTracer, renderer, controls, leftLight, rightLight, scene, camera;
let loader;

const params = {

	// area light settings
	isCircular: false,
	intensity: 10,
	color: '#ffffff',
	width: 0.15,
	height: 1.5,

	// path tracer settings
	enable: true,
	bounces: 15,
	renderScale: 1,
	filterGlossyFactor: 1,
	tiles: 1,
	multipleImportanceSampling: true,

	...getScaledSettings(),

};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// ltc textures so rect area lights rasterize correctly in the preview
	RectAreaLightTexturesLib.init();
	RectAreaLightNode.setLTC( RectAreaLightTexturesLib );

	// renderer
	renderer = new WebGPURenderer( { antialias: true } );
	renderer.init();
	renderer.toneMapping = AgXToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );

	// camera
	camera = new PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0.0, 0.9, 4.25 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 0.72, 0 );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// init scene
	scene = new Scene();

	// load the assets
	const gltf = await new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL );

	// position the model
	const box = new Box3();
	gltf.scene.traverse( c => {

		if ( c.material ) c.material.map = null;

	} );

	gltf.scene.scale.setScalar( 0.01 );
	gltf.scene.position.x = 0.05;
	gltf.scene.updateMatrixWorld( true );
	box.setFromObject( gltf.scene );
	gltf.scene.position.y -= box.min.y;
	scene.add( gltf.scene );

	// set the backdrop
	const size = box.getSize( new Vector3() );
	const dim = Math.max( size.x, size.y, size.z );
	const backdrop = new Backdrop( { width: 4 * dim, depth: 2.5 * dim, height: 1.75 * dim, curve: dim } );
	backdrop.position.set( 0, - 1e-3, box.min.z );
	scene.add( backdrop );

	// long, thin tube lights on either side of the model, kept out of frame. The path
	// tracer reads the "isCircular" flag to sample the light as a disk.
	leftLight = new RectAreaLight( new Color( 0xffffff ), params.intensity, params.width, params.height );
	leftLight.isCircular = false;
	leftLight.position.set( - 2.5, 1.25, 0.75 );
	leftLight.lookAt( 0, 1, 0 );
	scene.add( leftLight );

	rightLight = new RectAreaLight( new Color( 0xffffff ), params.intensity, params.width, params.height );
	rightLight.isCircular = false;
	rightLight.position.set( 2.5, 1.25, 0.75 );
	rightLight.lookAt( 0, 1, 0 );
	scene.add( rightLight );

	// initialize scene
	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'enable' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 10 ).onChange( onParamsChange );
	ptFolder.add( params, 'bounces', 1, 50, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.close();

	const areaLightFolder = gui.addFolder( 'Area Light' );
	areaLightFolder.add( params, 'isCircular' ).name( 'isCircular' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'intensity', 0, 200 ).name( 'intensity' ).onChange( onParamsChange );
	areaLightFolder.addColor( params, 'color' ).name( 'color' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'width', 0, 5 ).name( 'width' ).onChange( onParamsChange );
	areaLightFolder.add( params, 'height', 0, 5 ).name( 'height' ).onChange( onParamsChange );

	onParamsChange();
	onResize();
	window.addEventListener( 'resize', onResize );

	animate();

}

function onParamsChange() {

	[ leftLight, rightLight ].forEach( light => {

		light.isCircular = params.isCircular;
		light.intensity = params.intensity;
		light.width = params.width;
		light.height = params.height;
		light.color.set( params.color ).convertSRGBToLinear();
		light.visible = params.enabled;

	} );

	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;

	pathTracer.updateLights();

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

	if ( params.enable ) {

		pathTracer.renderSample();
		pathTracer.getSampleCountsAsync().then( counts => loader.setSamples( counts ) );

	} else {

		renderer.render( scene, camera );

	}

}
