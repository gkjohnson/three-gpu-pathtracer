import {
	ACESFilmicToneMapping, BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera,
	PlaneGeometry, Raycaster, Scene, SphereGeometry, Vector2, WebGPURenderer,
} from 'three/webgpu';

import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

const scene = new Scene();
const transformScene = new Scene();
const camera = new PerspectiveCamera( 50, 1, 0.1, 100 );
camera.position.set( 5, 4, 7 );

const renderer = new WebGPURenderer( { antialias: true } );
renderer.init();
renderer.toneMapping = ACESFilmicToneMapping;
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );

const pathTracer = new WebGPUPathTracer( renderer );
const environment = new GradientEquirectTexture();
environment.topColor.set( 0x88aacc );
environment.bottomColor.set( 0xffffff );
environment.update();
scene.background = scene.environment = environment;

const floor = new Mesh(
	new PlaneGeometry( 20, 20 ),
	new MeshStandardMaterial( { color: 0x888888, roughness: 0.8 } ),
);
floor.rotation.x = - Math.PI / 2;
scene.add( floor );

const objects = [];
let selected;

let transformNeedsUpdate = false;
let materialNeedsUpdate = false;

const orbit = new OrbitControls( camera, renderer.domElement );
orbit.target.y = 0.5;
orbit.addEventListener( 'change', () => pathTracer.updateCamera() );
orbit.update();

const transformControls = new TransformControls( camera, renderer.domElement );
transformScene.add( transformControls.getHelper() );
transformControls.addEventListener( 'mouseDown', () => orbit.enabled = false );
transformControls.addEventListener( 'change', () => transformNeedsUpdate = true );
transformControls.addEventListener( 'mouseUp', () => {

	orbit.enabled = true;
	transformNeedsUpdate = true;

} );

const transformModes = {
	KeyT: 'translate',
	KeyR: 'rotate',
	KeyS: 'scale',
};

window.addEventListener( 'keydown', event => {

	if ( event.target?.closest?.( 'input, select, textarea' ) || event.target?.isContentEditable ) return;

	const mode = transformModes[ event.code ];
	if ( mode !== undefined ) {

		transformControls.setMode( mode );
		event.preventDefault();

	}

} );

const raycaster = new Raycaster();
const pointer = new Vector2();
const pointerStart = new Vector2();
const pointerEnd = new Vector2();

const params = {
	add,
	remove,
	shape: 'Box',
	color: '#44aaff',
	roughness: 0.25,
	metalness: 0,
};

const gui = new GUI();
gui.add( params, 'add' ).name( 'Add' );
gui.add( params, 'remove' ).name( 'Delete' );
gui.add( params, 'shape', [ 'Box', 'Sphere' ] );
const colorController = gui.addColor( params, 'color' ).onChange( updateMaterial );
const roughnessController = gui.add( params, 'roughness', 0, 1, 0.01 ).onChange( updateMaterial );
const metalnessController = gui.add( params, 'metalness', 0, 1, 0.01 ).onChange( updateMaterial );

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
	select( raycaster.intersectObjects( objects )[ 0 ]?.object || null );

} );

function remove() {

	if ( ! selected ) return;
	const object = selected;
	transformControls.detach();
	scene.remove( object );
	objects.splice( objects.indexOf( object ), 1 );
	object.geometry.dispose();
	object.material.dispose();
	selected = objects.at( - 1 );
	select( selected );
	pathTracer.setScene( scene, camera );

}

function updateMaterial() {

	if ( ! selected ) return;
	selected.material.color.set( params.color );
	selected.material.roughness = params.roughness;
	selected.material.metalness = params.metalness;
	materialNeedsUpdate = true;

}

function add() {

	const geometry = params.shape === 'Box' ? new BoxGeometry() : new SphereGeometry( 0.6, 32, 16 );
	const object = new Mesh( geometry, new MeshStandardMaterial( {
		color: params.color,
		roughness: params.roughness,
		metalness: params.metalness,
	} ) );
	object.position.set( ( objects.length % 4 ) - 1.5, 0.6, 0 );
	objects.push( object );
	scene.add( object );
	select( object );
	pathTracer.setScene( scene, camera );

}

function select( object ) {

	selected = object;
	if ( object ) {

		transformControls.attach( object );
		params.color = `#${ object.material.color.getHexString() }`;
		params.roughness = object.material.roughness;
		params.metalness = object.material.metalness;

	} else {

		transformControls.detach();

	}

	colorController.updateDisplay();
	roughnessController.updateDisplay();
	metalnessController.updateDisplay();

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

	if ( selected ) {

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

add();
resize();
window.addEventListener( 'resize', resize );
