import * as THREE from 'three';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GraphMaterial } from '../src/index.js';
import { shaderGGXFunctions } from '../src/shader/shaderGGXFunctions.js';
import { shaderUtils } from '../src/shader/shaderUtils.js';

let camera, scene, renderer, plane;
let xRange, yRange;
let cameraCenter;
let zoom = 10;
const params = {
	aspect: 1,
};

init();

function getAspect() {

	return params.aspect * window.innerHeight / window.innerWidth;

}

// init
async function init() {

	// renderer init
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x11161C );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.setAnimationLoop( animation );
	document.body.appendChild( renderer.domElement );

	// init camera
	camera = new THREE.OrthographicCamera();
	camera.position.set( 0, 0, 1.5 );

	scene = new THREE.Scene();

	xRange = new THREE.Vector2( 0, 1.0 );
	yRange = new THREE.Vector2( 0, 5.0 );
	cameraCenter = new THREE.Vector2();

	// image plane
	plane = new THREE.Mesh(
		new THREE.PlaneGeometry(),
		new GraphMaterial( {
			side: THREE.DoubleSide,
			thickness: 1,
			functionContent: /* glsl */`
				#include <common>
				${ shaderUtils }
				${ shaderGGXFunctions }

				vec4 callback( float x ) {

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
			`
		} )
	);
	plane.scale.setScalar( 2.0 );
	scene.add( plane );

	cameraCenter.set(
		- zoom * 0.45,
		getAspect() * zoom * 0.4,
	);

	const gui = new GUI();
	gui.add( plane.material, 'dim' );
	gui.add( plane.material, 'thickness', 0.1, 10.0 );
	gui.add( plane.material, 'graphCount', 1.0, 4.0, 1.0 );

	const aspectFolder = gui.addFolder( 'aspect' );
	aspectFolder.add( params, 'aspect', 0.1, 2 );

	const xAxis = gui.addFolder( 'x axis' );
	xAxis.add( xRange, 'x', - 20, 20, 0.25 ).name( 'min' );
	xAxis.add( xRange, 'y', - 20, 20, 0.25 ).name( 'min' );

	const yAxis = gui.addFolder( 'y axis' );
	yAxis.add( yRange, 'x', - 10, 10, 0.25 ).name( 'min' );
	yAxis.add( yRange, 'y', - 10, 10, 0.25 ).name( 'min' );

	let clicked = false;
	let prevX = - 1;
	let prevY = - 1;
	renderer.domElement.addEventListener( 'pointerdown', e => {

		clicked = true;
		prevX = e.clientX;
		prevY = e.clientY;

	} );

	renderer.domElement.addEventListener( 'pointermove', e => {

		clicked = Boolean( e.buttons & 1 );
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

	renderer.render( scene, camera );

}
