import {
	ACESFilmicToneMapping, Box3, Box3Helper, MeshPhysicalMaterial,
	PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGPURenderer,
} from 'three/webgpu';

import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { LoaderElement } from './src/LoaderElement.js';

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/renderman-teapot/renderman-teapot.glb';
const CREDITS = 'Model courtesy of RenderMan';
const DESCRIPTION = 'Click a teapot to select it. Press W / E / R for Translate / Rotate / Scale.';

const scene = new Scene();
const transformScene = new Scene();
const camera = new PerspectiveCamera( 50, 1, 0.01, 100 );

const renderer = new WebGPURenderer( { antialias: true } );
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild( renderer.domElement );

const pathTracer = new WebGPUPathTracer( renderer );
pathTracer.maxSamples = 10;

const environment = new GradientEquirectTexture();
environment.topColor.set( 0x88aacc );
environment.bottomColor.set( 0xffffff );
environment.update();
scene.environment = environment;
scene.environmentIntensity = 1.5;
scene.background = environment;

const MAX_TEAPOTS = 5;

// ceramic glazes, ordered so consecutive pots contrast in both hue and value
const COLORS = [
	0xe57373,
	0x4db6ac,
	0xff9800,
	0x66bb6a,
	0xf5f5f5,
	0x29b6f6,
	0xff5722,
];

// the flat part of the stage, in multiples of the pot's own radius
const STAGE_HALF_WIDTH = 2.5;
const STAGE_HALF_DEPTH = 1.5;

const objects = [];
let selected;
let colorIndex = 0;

// the first pot doubles as the template new ones are cloned from
let teapot, teapotParent, stageScale;
const basePosition = new Vector3();

let transformNeedsUpdate = false;
let materialNeedsUpdate = false;

const orbit = new OrbitControls( camera, renderer.domElement );
orbit.addEventListener( 'change', () => pathTracer.updateCamera() );

// the selection is outlined in the overlay pass, so it never disturbs the path traced image
const selectionBox = new Box3Helper( new Box3(), 0xffffff );
selectionBox.visible = false;
transformScene.add( selectionBox );

const transformControls = new TransformControls( camera, renderer.domElement );
transformControls.size = 0.75;
transformScene.add( transformControls.getHelper() );
transformControls.addEventListener( 'mouseDown', () => orbit.enabled = false );
transformControls.addEventListener( 'mouseUp', () => orbit.enabled = true );

// "change" also fires when the gizmo merely highlights under the cursor, so the accumulated render
// is only thrown away when the attached object actually moves
transformControls.addEventListener( 'objectChange', () => transformNeedsUpdate = true );

const transformModes = {
	KeyW: 'translate',
	KeyE: 'rotate',
	KeyR: 'scale',
};

window.addEventListener( 'keydown', event => {

	if ( event.target?.closest?.( 'input, select, textarea' ) || event.target?.isContentEditable ) return;

	const mode = transformModes[ event.code ];
	if ( mode !== undefined ) {

		transformControls.setMode( mode );
		event.preventDefault();

	}

} );

const loader = new LoaderElement();
loader.attach( document.body );

const raycaster = new Raycaster();
const pointer = new Vector2();
const pointerStart = new Vector2();
const pointerEnd = new Vector2();

const params = {
	add,
	remove,
	color: '#44aaff',
	roughness: 0.25,
};

const gui = new GUI();
const addController = gui.add( params, 'add' ).name( 'Add' );
const removeController = gui.add( params, 'remove' ).name( 'Delete' );
const colorController = gui.addColor( params, 'color' ).onChange( updateMaterial );
const roughnessController = gui.add( params, 'roughness', 0, 1, 0.01 ).onChange( updateMaterial );

renderer.domElement.addEventListener( 'pointerdown', event => pointerStart.set( event.clientX, event.clientY ) );
renderer.domElement.addEventListener( 'pointerup', event => {

	pointerEnd.set( event.clientX, event.clientY );
	if ( transformControls.dragging || pointerStart.distanceTo( pointerEnd ) > 4 ) return;

	const rect = renderer.domElement.getBoundingClientRect();
	pointer.set(
		( ( event.clientX - rect.left ) / rect.width ) * 2 - 1,
		- ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1,
	);
	raycaster.setFromCamera( pointer, camera );

	// the hit is a mesh somewhere inside a selectable object, so walk back up to that object
	let hit = raycaster.intersectObjects( objects, true )[ 0 ]?.object || null;
	while ( hit && ! objects.includes( hit ) ) hit = hit.parent;
	select( hit );

} );

function remove() {

	if ( ! selected ) return;
	const object = selected;
	transformControls.detach();
	object.removeFromParent();
	objects.splice( objects.indexOf( object ), 1 );

	// the geometry is shared with every other pot, so only the per pot material is freed
	object.userData.material.dispose();

	selected = objects.at( - 1 );
	select( selected );
	pathTracer.setScene( scene, camera );

}

function updateMaterial() {

	if ( ! selected ) return;
	const material = selected.userData.material;

	// a transmissive pot is tinted by what the light passes through rather than by the surface
	const tint = material.transmission > 0 ? material.attenuationColor : material.color;
	tint.set( params.color );

	material.roughness = params.roughness;
	materialNeedsUpdate = true;

}

// Picks a spot in the stage rectangle, taking the candidate that sits furthest from the pots
// already placed so a new one does not land on top of its neighbours.
function randomStagePosition() {

	const candidate = new Vector3();
	const other = new Vector3();
	let best = null;
	let bestDistance = - Infinity;

	for ( let i = 0; i < 20; i ++ ) {

		candidate.set(
			basePosition.x + ( Math.random() * 2 - 1 ) * STAGE_HALF_WIDTH * stageScale,
			basePosition.y,
			basePosition.z + ( Math.random() * 2 - 1 ) * STAGE_HALF_DEPTH * stageScale,
		);

		let distance = Infinity;
		for ( const object of objects ) {

			object.getWorldPosition( other );
			distance = Math.min( distance, candidate.distanceTo( other ) );

		}

		if ( distance > bestDistance ) {

			bestDistance = distance;
			best = candidate.clone();

		}

	}

	return best;

}

function add() {

	if ( objects.length >= MAX_TEAPOTS ) return;

	const object = teapot.clone();

	// the clone shares geometry with the original but takes its own copy of the material so the
	// gui only edits the selected pot
	const source = teapot.userData.material;
	const material = source.clone();
	object.traverse( c => {

		if ( c.material === source ) c.material = material;

	} );
	object.userData.material = material;

	// a new glaze from the palette so a new pot is not a copy of the one it came from
	material.color.set( COLORS[ colorIndex % COLORS.length ] );
	material.roughness = Math.random();
	material.metalness = 0;
	colorIndex ++;

	const r = Math.random();
	if ( r < 0.333 ) {

		material.metalness = 1;

	} else if ( r < 0.666 ) {

		material.attenuationColor.copy( material.color );
		material.color.set( 0xffffff );
		material.transmission = 1;
		material.attenuationDistance = 0.01;
		material.thickness = 1;
		material.roughness = Math.random() * 0.25;

	}

	// the position is chosen in world space then converted so the pot inherits the model scale
	object.position.copy( teapotParent.worldToLocal( randomStagePosition() ) );
	object.rotation.y = Math.random() * 2 * Math.PI;

	objects.push( object );
	teapotParent.add( object );
	select( object );
	pathTracer.setScene( scene, camera );

}

function select( object ) {

	selected = object;
	if ( object ) {

		transformControls.attach( object );

		const material = object.userData.material;
		const tint = material.transmission > 0 ? material.attenuationColor : material.color;
		params.color = `#${ tint.getHexString() }`;
		params.roughness = material.roughness;

	} else {

		transformControls.detach();

	}

	selectionBox.visible = Boolean( selected );

	colorController.updateDisplay().enable( Boolean( selected ) );
	roughnessController.updateDisplay().enable( Boolean( selected ) );

	addController.enable( objects.length < MAX_TEAPOTS );
	removeController.enable( Boolean( selected ) );

}

function animate() {

	if ( transformNeedsUpdate ) {

		transformNeedsUpdate = false;
		pathTracer.updateTransforms();

	}

	if ( materialNeedsUpdate ) {

		materialNeedsUpdate = false;
		pathTracer.updateMaterials();

	}

	pathTracer.renderSample();

	pathTracer.getSampleCountsAsync().then( counts => loader.setSamples( counts ) );

	if ( selected ) {

		selectionBox.box.setFromObject( selected );

		const originalAutoClear = renderer.autoClear;
		renderer.autoClear = false;
		renderer.clearDepth();
		renderer.render( transformScene, camera );
		renderer.autoClear = originalAutoClear;

	}

}

function resize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	pathTracer.updateCamera();

}

// Loads the teapot and prepares it for the scene. The file ships several variants of the pot
// stacked in the same spot along with two coplanar floors, so most of it is discarded and the
// surfaces that are kept are given new materials.
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

	model.scale.setScalar( 0.01 );

	// glazed ceramic for the pot and its base, leaving the ring, logo and floor as they are
	const ceramic = [ 'teapot_Body_Hollow', 'teapot_Lid', 'teapot_Foot_Left_02', 'teapot_Foot_Right_02', 'teapot_Steps_02' ];
	const ceramicMaterial = new MeshPhysicalMaterial( {
		color: 0xb2dfdb,
		metalness: 1.0,
		roughness: 0.2,
	} );
	ceramic.forEach( name => model.getObjectByName( name ).material = ceramicMaterial );

	// the ring and logo share a near black material, lightened here
	model.getObjectByName( 'teapot_Base_02' ).material.color.set( 0x333333 );

	// lighten the stage and backdrop so the pots read against it
	model.getObjectByName( 'floor_W_Grid' ).material.color.set( 0xdedede );

	// the pot is selected and edited as a whole, so it carries the one material the gui drives
	const teapot = model.getObjectByName( 'Teapot_Grp' );
	teapot.scale.setScalar( 0.05 );
	teapot.position.y -= 0.375;
	teapot.userData.material = ceramicMaterial;

	return model;

}

async function init() {

	await renderer.init();

	const model = await loadModel();
	scene.add( model );
	scene.updateMatrixWorld( true );

	// the pots are the only selectable objects, so the floor stays put
	teapot = model.getObjectByName( 'Teapot_Grp' );
	teapotParent = teapot.parent;
	objects.push( teapot );

	// frame the camera on the teapot rather than the backdrop
	const box = new Box3().setFromObject( teapot );
	const center = box.getCenter( new Vector3() );
	const radius = box.getSize( new Vector3() ).length() * 0.5;

	// new pots are scattered over the stage rectangle around the original
	teapot.getWorldPosition( basePosition );
	stageScale = radius;

	camera.position.copy( center ).add( new Vector3( 0.15, 0.35, 1 ).normalize().multiplyScalar( radius * 6 ) );
	orbit.target.copy( center );
	orbit.update();

	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

	// nothing is selected yet, so this sets the initial button states
	select( null );

	resize();
	window.addEventListener( 'resize', resize );
	renderer.setAnimationLoop( animate );

}

init();
