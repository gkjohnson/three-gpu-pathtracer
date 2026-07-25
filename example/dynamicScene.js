import {
	ACESFilmicToneMapping, BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera,
	PlaneGeometry, Scene, SphereGeometry, WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

const scene = new Scene();
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
let selected, dragging = false;
const orbit = new OrbitControls( camera, renderer.domElement );
orbit.target.y = 0.5;
orbit.addEventListener( 'change', () => pathTracer.updateCamera() );
orbit.update();

const drag = new DragControls( objects, camera, renderer.domElement );
drag.addEventListener( 'dragstart', e => {

	select( e.object );
	dragging = true;
	orbit.enabled = false;

} );
drag.addEventListener( 'dragend', () => {

	dragging = false;
	orbit.enabled = true;
	pathTracer.setScene( scene, camera );

} );

const ui = Object.fromEntries( [ 'add', 'remove', 'shape', 'color', 'roughness', 'metalness' ].map( id => [ id, document.getElementById( id ) ] ) );
ui.add.onclick = add;
ui.remove.onclick = () => {

	if ( ! selected ) return;
	scene.remove( selected );
	objects.splice( objects.indexOf( selected ), 1 );
	selected.geometry.dispose();
	selected.material.dispose();
	selected = objects.at( - 1 );
	if ( selected ) select( selected );
	pathTracer.setScene( scene, camera );

};

for ( const key of [ 'color', 'roughness', 'metalness' ] ) {

	ui[ key ].oninput = () => {

		if ( ! selected ) return;
		if ( key === 'color' ) selected.material.color.set( ui[ key ].value );
		else selected.material[ key ] = Number( ui[ key ].value );
		pathTracer.updateMaterials();

	};

}

function add() {

	const geometry = ui.shape.value === 'Box' ? new BoxGeometry() : new SphereGeometry( 0.6, 32, 16 );
	const object = new Mesh( geometry, new MeshStandardMaterial( { color: ui.color.value, roughness: 0.25 } ) );
	object.position.set( ( objects.length % 4 ) - 1.5, 0.6, 0 );
	objects.push( object );
	scene.add( object );
	select( object );
	pathTracer.setScene( scene, camera );

}

function select( object ) {

	selected = object;
	ui.color.value = `#${ object.material.color.getHexString() }`;
	ui.roughness.value = object.material.roughness;
	ui.metalness.value = object.material.metalness;

}

function animate() {

	if ( dragging ) renderer.render( scene, camera );
	else pathTracer.renderSample();

}

function resize() {

	renderer.setSize( innerWidth, innerHeight );
	renderer.setPixelRatio( devicePixelRatio );
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	pathTracer.updateCamera();

}

add();
add();
resize();
window.addEventListener( 'resize', resize );
