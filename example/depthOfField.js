import {
	Box3,
	Vector2,
	Vector3,
	ACESFilmicToneMapping,
	Scene,
	Raycaster,
	WebGPURenderer,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getScaledSettings } from './src/getScaledSettings.js';
import { LoaderElement } from './src/LoaderElement.js';

const MODEL_URL = './data/renderman-teapot.glb';
const CREDITS = 'RenderMan teapot model';
const DESCRIPTION = 'Path tracing with configurable bokeh and depth of field. Click point in scene to focus.';

let pathTracer, renderer, controls, camera, scene;
let loader;
const mouse = new Vector2();
const focusPoint = new Vector3();
const params = {

	bounces: 15,
	renderScale: 1,
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
	renderer = new WebGPURenderer( { antialias: true } );
	renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );

	// camera, positioned once the model bounds are known
	camera = new PhysicalCamera( 25, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.apertureBlades = 6;
	camera.fStop = 4;

	// background and environment
	const gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( 0xffffff );
	gradientMap.bottomColor.set( 0x666666 );
	gradientMap.update();

	// scene
	scene = new Scene();
	scene.background = gradientMap;
	scene.environment = gradientMap;

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		if ( params.autoFocus ) {

			camera.focusDistance = camera.position.distanceTo( focusPoint ) - camera.near;

		}

		pathTracer.updateCamera();

	} );

	const gltf = await new GLTFLoader().loadAsync( MODEL_URL );

	// The file stacks several teapot variants in the same spot along with two coplanar copies of
	// the floor, so everything but the solid teapot and the gridded floor is removed.
	const REMOVE = [ 'teapot_Hollow_Grp', 'teapot_Liquid_Grp', 'teapot_Cloth_Grp', 'teapot_Glasses_Grp', 'floor', 'ten_cm_text' ];
	REMOVE.forEach( name => gltf.scene.getObjectByName( name ).removeFromParent() );

	// the model is authored in centimeters while the physical camera aperture works in meters
	gltf.scene.scale.setScalar( 0.01 );

	// turn the pot itself into tinted glass, leaving the pedestal and floor as they are
	const GLASS = [ 'teapot_Body_Solid', 'teapot_Lid', 'teapot_Foot_Left', 'teapot_Foot_Right' ];
	GLASS.forEach( name => {

		const material = gltf.scene.getObjectByName( name ).material;
		material.map = null;
		material.color.set( 0xffffff );
		material.metalness = 0;
		material.roughness = 0.05;
		material.transmission = 1;
		material.ior = 1.5;
		material.attenuationColor.set( 0xd08a4a );
		material.attenuationDistance = 0.15;

	} );

	scene.add( gltf.scene );
	scene.updateMatrixWorld( true );

	// frame the camera on the teapot rather than the backdrop
	const box = new Box3().setFromObject( gltf.scene.getObjectByName( 'Teapot_Grp' ) );
	const center = box.getCenter( new Vector3() );
	const radius = box.getSize( new Vector3() ).length() * 0.5;

	// a head on view, pulled back to fill the frame at the narrower fov
	camera.position.copy( center ).add( new Vector3( 0, 0.12, 1 ).normalize().multiplyScalar( radius * 3.6 ) );
	controls.target.copy( center );
	controls.update();

	focusPoint.copy( center );
	camera.focusDistance = camera.position.distanceTo( focusPoint ) - camera.near;


	// update the scene
	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
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
	ptFolder.add( params, 'bounces', 1, 50, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( camera, 'focusDistance', radius * 0.5, radius * 15 ).onChange( onParamsChange ).listen();
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
	if ( deltaMouse < 2 ) {

		const raycaster = new Raycaster();
		raycaster.setFromCamera( {

			x: ( e.clientX / window.innerWidth ) * 2 - 1,
			y: - ( e.clientY / window.innerHeight ) * 2 + 1,

		}, camera );

		raycaster.firstHitOnly = true;
		const hit = raycaster.intersectObject( scene )[ 0 ];
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

	pathTracer.getSampleCountsAsync().then( counts => loader.setSamples( counts ) );

}
