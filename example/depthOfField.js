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
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './src/LoaderElement.js';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/renderman-teapot/renderman-teapot.glb';
const CREDITS = 'RenderMan teapot model';
const DESCRIPTION = 'Path tracing with configurable bokeh and depth of field. Click point in scene to focus.';

let pathTracer, renderer, controls, camera, scene;
let loader;
const mouse = new Vector2();
const focusPoint = new Vector3();
const params = {

	enabled: true,
	bounces: 7,
	renderScale: 1,
	filterGlossyFactor: 0.5,
	autoFocus: true,

};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );

	// camera, positioned once the model bounds are known
	camera = new PhysicalCamera( 25, window.innerWidth / window.innerHeight, 0.025, 500 );
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

	const model = await loadModel();
	scene.add( model );
	scene.updateMatrixWorld( true );

	// frame the camera on the teapot rather than the backdrop
	const box = new Box3().setFromObject( model.getObjectByName( 'Teapot_Grp' ) );
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

	buildGui( radius );

	animate();

}

// the focus range is derived from the model size so the slider stays useful at any scale
function buildGui( radius ) {

	const gui = new GUI();

	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'enabled' );
	ptFolder.add( params, 'bounces', 1, 20, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( params, 'autoFocus' );
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

}

// Loads the teapot and prepares it for the scene. The file ships several variants of the pot
// stacked in the same spot along with two coplanar floors, so most of it is discarded and the
// surfaces that are kept are re-materialed.
async function loadModel() {

	const gltf = await new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL );
	const model = gltf.scene;

	// keep the hollow pot, the solid variant's lid, and the gridded floor
	const remove = [
		'teapot_Liquid_Grp', 'teapot_Cloth_Grp', 'teapot_Glasses_Grp',
		'teapot_Body_Solid', 'teapot_Foot_Left', 'teapot_Foot_Right', 'teapot_Steps', 'teapot_Base',
		'floor', 'ten_cm_text',
	];
	remove.forEach( name => model.getObjectByName( name ).removeFromParent() );

	// the model is authored in centimeters while the physical camera aperture works in meters
	model.scale.setScalar( 0.01 );

	// glazed ceramic for the pot and its base, leaving the ring, logo and floor as they are
	const ceramic = [ 'teapot_Body_Hollow', 'teapot_Lid', 'teapot_Foot_Left_02', 'teapot_Foot_Right_02', 'teapot_Steps_02' ];
	const ceramicMaterial = new MeshPhysicalMaterial( {
		color: 0xb4471f,
		metalness: 0,
		roughness: 0.6,
		clearcoat: 0.4,
		clearcoatRoughness: 0.3,
	} );
	ceramicMaterial.diffuseRoughness = 1;
	ceramic.forEach( name => model.getObjectByName( name ).material = ceramicMaterial );

	// the ring and logo share a near black material, lightened here
	model.getObjectByName( 'teapot_Base_02' ).material.color.set( 0x333333 );

	return model;

}

// mouse events for focusing on the clicked point
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

	// the rasterized scene, for comparison against the path traced result
	if ( ! params.enabled ) {

		renderer.render( scene, camera );
		return;

	}

	pathTracer.renderSample();

	pathTracer.getSampleCountsAsync().then( counts => loader.setSamples( counts ) );

}
