import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GraphMaterial } from '../src/index.js';
import { shaderGGXFunctions } from '../src/shader/shaderGGXFunctions.js';
import { shaderUtils } from '../src/shader/shaderUtils.js';

let camera, scene, renderer, controls;

init();

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

	// image plane
	const plane = new THREE.Mesh(
		new THREE.PlaneGeometry(),
		new GraphMaterial( {
			side: THREE.DoubleSide,
			thickness: 2,
			xRange: new THREE.Vector2( 0, 1.0 ),
			yRange: new THREE.Vector2( 0, 5.0 ),
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
	plane.scale.setScalar( 1.75 );
	scene.add( plane );



	const gui = new GUI();
	gui.add( plane.material, 'overlay' );
	gui.add( plane.material, 'thickness', 1.0, 3.0 );
	gui.add( plane.material, 'graphCount', 1.0, 4.0, 1.0 );

	const xAxis = gui.addFolder( 'x axis' );
	xAxis.add( plane.material.xRange, 'x', - 20, 20, 0.25 ).name( 'min' );
	xAxis.add( plane.material.xRange, 'y', - 20, 20, 0.25 ).name( 'min' );

	const yAxis = gui.addFolder( 'y axis' );
	yAxis.add( plane.material.yRange, 'x', - 10, 10, 0.25 ).name( 'min' );
	yAxis.add( plane.material.yRange, 'y', - 10, 10, 0.25 ).name( 'min' );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.mouseButtons.LEFT = THREE.MOUSE.PAN;

	window.addEventListener( 'resize', () => {

		renderer.setSize( window.innerWidth, window.innerHeight );
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

	} );

}

// animation
function animation() {

	renderer.render( scene, camera );

}
