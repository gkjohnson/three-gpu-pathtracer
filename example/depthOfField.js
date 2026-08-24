import {
	Box3,
	Vector2,
	Vector3,
	ACESFilmicToneMapping,
	MeshPhysicalMaterial,
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
const TINT = 0xb4471f;
const GREY = 0x333333;
const CREDITS = 'RenderMan teapot model';
const DESCRIPTION = 'Path tracing with configurable bokeh and depth of field. Click point in scene to focus.';

let pathTracer, renderer, controls, camera, scene;
let loader;
const mouse = new Vector2();
const focusPoint = new Vector3();
const params = {

	bounces: 7,
	renderScale: 1,
	filterGlossyFactor: 0.5,
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

	// camera, positioned once the model bounds are known
	camera = new PhysicalCamera( 25, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.apertureBlades = 6;
	camera.fStop = 1.5;

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
	// the floor. The hollow pot is kept with the calm liquid inside it, along with the solid
	// variant's lid since the hollow one has none, plus the gridded floor; everything else is
	// removed.
	const REMOVE = [
		'teapot_Cloth_Grp', 'teapot_Glasses_Grp', 'floor', 'ten_cm_text',
		'teapot_Body_Solid', 'teapot_Foot_Left', 'teapot_Foot_Right',
		'teapot_Steps', 'teapot_Base',
		'liquid_Splash', 'liquid_Splash_02', 'liquid_Splash_02_Foam', 'garnish',
	];
	REMOVE.forEach( name => gltf.scene.getObjectByName( name ).removeFromParent() );

	// the model is authored in centimeters while the physical camera aperture works in meters
	gltf.scene.scale.setScalar( 0.01 );

	// glazed ceramic for the pot and its base, leaving the ring, logo and floor as they are
	const CERAMIC = [ 'teapot_Body_Hollow', 'teapot_Lid', 'teapot_Foot_Left_02', 'teapot_Foot_Right_02', 'teapot_Steps_02' ];
	const ceramicMaterial = new MeshPhysicalMaterial( {
		color: TINT,
		metalness: 0,
		roughness: 0.6,
		clearcoat: 0.4,
		clearcoatRoughness: 0.3,
	} );
	ceramicMaterial.diffuseRoughness = 1;
	CERAMIC.forEach( name => {

		gltf.scene.getObjectByName( name ).material = ceramicMaterial;

	} );

	// the ring and logo share a near black material, lightened here
	gltf.scene.getObjectByName( 'teapot_Base_02' ).material.color.set( GREY );

	scene.add( gltf.scene );
	scene.updateMatrixWorld( true );

	// frame the camera on the teapot rather than the backdrop
	const box = new Box3().setFromObject( gltf.scene.getObjectByName( 'Teapot_Grp' ) );
	const center = box.getCenter( new Vector3() );
	const radius = box.getSize( new Vector3() ).length() * 0.5;

	// a head on view, pulled back to fill the frame at the narrower fov
	camera.position.copy( center ).add( new Vector3( 0, 0.12, 1 ).normalize().multiplyScalar( radius * 3.9 ) );
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
	ptFolder.add( params, 'bounces', 1, 20, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( camera, 'focusDistance', radius * 1.5, radius * 8 ).onChange( onParamsChange ).listen();
	cameraFolder.add( camera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		camera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		onParamsChange();


	} );

	// a full turn covers every orientation for any blade count
	cameraFolder.add( camera, 'apertureRotation', 0, 2 * Math.PI ).onChange( onParamsChange );
	cameraFolder.add( camera, 'anamorphicRatio', 0.5, 2 ).onChange( onParamsChange );
	cameraFolder.add( camera, 'bokehSize', 1, 50 ).onChange( onParamsChange ).listen();
	cameraFolder.add( camera, 'fStop', 0.5, 16 ).onChange( onParamsChange ).listen();
	cameraFolder.add( camera, 'fov', 15, 60 ).onChange( () => {

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
