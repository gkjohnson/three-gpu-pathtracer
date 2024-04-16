import * as THREE from 'three';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GraphMaterial } from '../src/materials/debug/GraphMaterial.js';
import * as BSDFGLSL from '../src/shader/bsdf/index.js';
import * as CommonGLSL from '../src/shader/common/index.js';

const graphFunctionSnippet = /* glsl */`
	#include <common>
	${ CommonGLSL.math_functions }
	${ CommonGLSL.util_functions }
	${ BSDFGLSL.ggx_functions }

	vec4 graphFunction( float x ) {

		vec3 wi = normalize( vec3( 1.0, 1.0, 1.0 ) );
		vec3 halfVec = vec3( 0.0, 0.0, 1.0 );
		float theta = dot( wi, halfVec );

		return vec4(
			ggxPDF( wi, halfVec, x ),
			ggxDistribution( halfVec, x ),
			ggxShadowMaskG1( theta, x ),
			ggxLamda( theta, x )
		);

	}
`;

let camera, scene, renderer, plane;
let cameraCenter;
let zoom = 10;
let dataEl, dataContainerEl;
const params = {
	aspect: 1,
	displayX: true,
	displayY: true,
	displayZ: true,
	displayW: true,
	reset() {

		zoom = 10;
		cameraCenter.set(
			- zoom * 0.5 + zoom * 0.05,
			getAspect() * zoom * 0.5 - zoom * 0.05,
		);

	}
};

init();

// init
async function init() {

	dataContainerEl = document.getElementById( 'dataContainer' );
	dataEl = document.getElementById( 'data' );

	// renderer init
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x11161C );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setAnimationLoop( animation );
	document.body.appendChild( renderer.domElement );

	// init camera
	camera = new THREE.OrthographicCamera();
	camera.position.set( 0, 0, 1.5 );

	scene = new THREE.Scene();

	cameraCenter = new THREE.Vector2();

	// image plane
	plane = new THREE.Mesh(
		new THREE.PlaneGeometry(),
		new GraphMaterial( {
			side: THREE.DoubleSide,
			thickness: 1,
			graphFunctionSnippet,
		} )
	);
	plane.scale.setScalar( 2.0 );
	scene.add( plane );

	cameraCenter.set(
		- zoom * 0.5 + zoom * 0.05,
		getAspect() * zoom * 0.5 - zoom * 0.05,
	);

	const gui = new GUI();
	gui.add( plane.material, 'dim' );
	gui.add( plane.material, 'thickness', 0.5, 10.0 );
	gui.add( params, 'aspect', 0.1, 2 );
	gui.add( params, 'reset' );

	const graphFolder = gui.addFolder( 'graphs' );
	graphFolder.add( params, 'displayX' ).name( 'display graph 1' );
	graphFolder.add( params, 'displayY' ).name( 'display graph 2' );
	graphFolder.add( params, 'displayZ' ).name( 'display graph 3' );
	graphFolder.add( params, 'displayW' ).name( 'display graph 4' );

	let clicked = false;
	let prevX = - 1;
	let prevY = - 1;
	renderer.domElement.addEventListener( 'pointerleave', () =>{

		dataContainerEl.style.visibility = 'hidden';

	} );

	renderer.domElement.addEventListener( 'pointerenter', () =>{

		dataContainerEl.style.visibility = 'visible';

	} );

	renderer.domElement.addEventListener( 'pointerdown', e => {

		clicked = true;
		prevX = e.clientX;
		prevY = e.clientY;

	} );

	renderer.domElement.addEventListener( 'pointermove', e => {

		clicked = clicked && Boolean( e.buttons & 1 );
		if ( clicked ) {

			const deltaX = e.clientX - prevX;
			const deltaY = e.clientY - prevY;

			prevX = e.clientX;
			prevY = e.clientY;

			const xWidth = 1;
			const yWidth = getAspect();

			const graphDeltaX = zoom * xWidth * deltaX / window.innerWidth;
			const graphDeltaY = zoom * yWidth * deltaY / window.innerHeight;

			cameraCenter.x += graphDeltaX;
			cameraCenter.y += graphDeltaY;

		}

		dataContainerEl.style.left = `${ e.clientX }px`;
		dataContainerEl.style.top = `${ e.clientY }px`;

		const data = mouseToGraphValue( e.clientX, e.clientY );
		dataEl.innerText = `x: ${ data.x.toFixed( 3 ) }\ny: ${ data.y.toFixed( 3 ) }`;

	} );

	renderer.domElement.addEventListener( 'wheel', e => {

		const mouseX = e.clientX;
		const mouseY = e.clientY;

		const xWidth = 1;
		const yWidth = getAspect();

		const centerRelX = ( mouseX / window.innerWidth ) - 0.5;
		const centerRelY = ( mouseY / window.innerHeight ) - 0.5;

		const graphX = zoom * xWidth * centerRelX;
		const graphY = zoom * yWidth * centerRelY;

		const beforeZoom = zoom;
		const delta = Math.pow( 0.95, 1.0 );

		if ( e.deltaY < 0 ) {

			zoom *= delta;

		} else {

			zoom /= delta;

		}

		zoom = Math.max( zoom, 0.1 );
		zoom = Math.min( zoom, 100 );

		const afterX = graphX * zoom / beforeZoom;
		const afterY = graphY * zoom / beforeZoom;

		cameraCenter.x -= graphX - afterX;
		cameraCenter.y -= graphY - afterY;

	} );

	window.addEventListener( 'resize', () => {

		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

// animation
function animation() {

	const mat = plane.material;
	const xWidth = 1;
	const yWidth = getAspect();

	mat.xRange.set(
		- cameraCenter.x - 0.5 * xWidth * zoom,
		- cameraCenter.x + 0.5 * xWidth * zoom,
	);

	mat.yRange.set(
		cameraCenter.y - 0.5 * yWidth * zoom,
		cameraCenter.y + 0.5 * yWidth * zoom,
	);

	mat.graphDisplay.set(
		Number( params.displayX ),
		Number( params.displayY ),
		Number( params.displayZ ),
		Number( params.displayW ),
	);

	renderer.render( scene, camera );

}

function getAspect() {

	return params.aspect * window.innerHeight / window.innerWidth;

}

function mouseToGraphValue( x, y ) {

	const xWidth = 1;
	const yWidth = getAspect();

	const centerRelX = ( x / window.innerWidth ) - 0.5;
	const centerRelY = ( y / window.innerHeight ) - 0.5;

	const graphX = zoom * xWidth * centerRelX - cameraCenter.x;
	const graphY = zoom * yWidth * centerRelY - cameraCenter.y;

	return { x: graphX, y: - graphY };

}
