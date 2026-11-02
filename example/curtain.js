import {
	Scene,
	PlaneGeometry,
	Mesh,
	MeshStandardMaterial,
	WebGPURenderer,
	Color,
	DoubleSide,
	DataTexture,
	EquirectangularReflectionMapping,
	FloatType,
	RGBAFormat,
} from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera } from 'three-gpu-pathtracer';
import { WebGPUPathTracer, RANDOM_SOBOL } from 'three-gpu-pathtracer/webgpu';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './src/LoaderElement.js';

let pathTracer, renderer, controls;
let camera, scene, curtain, curtainMaterial;
let loader;

const params = {

	opacity: 0.5,
	curtain: true,
	visibleToShadowRays: true,
	multipleImportanceSampling: true,

};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGPURenderer( { antialias: true } );
	renderer.init();
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.renderScale = 0.5;
	pathTracer.setRandom( RANDOM_SOBOL );
	pathTracer.maxSamples = 3;
	pathTracer.addEventListener( 'progress', ( { stage, progress, samples } ) => {

		loader.setStage( stage, progress, samples );

	} );

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PhysicalCamera( 50, aspect, 0.05, 50 );
	camera.position.set( - 2.2, 2.0, 3.4 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 0.6, 0 );
	controls.update();
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();

	} );

	// scene, lit only by a white sky above a partially transparent panel. Bsdf rays find the sky often,
	// so light counted twice through the panel is easy to see
	const sky = new DataTexture( new Float32Array( 4 * 2 * 4 ).fill( 1 ), 4, 2, RGBAFormat, FloatType );
	sky.mapping = EquirectangularReflectionMapping;
	sky.needsUpdate = true;

	scene = new Scene();
	scene.environment = sky;
	scene.background = new Color( 0 );

	const white = new MeshStandardMaterial( { color: 0xdddddd, roughness: 1 } );
	const floor = new Mesh( new PlaneGeometry( 6, 6 ), white );
	floor.rotation.x = - Math.PI / 2;

	const wall = new Mesh( new PlaneGeometry( 6, 3 ), white );
	wall.position.set( 0, 1.5, - 1.5 );

	curtainMaterial = new MeshStandardMaterial( {
		color: 0x000000,
		roughness: 1,
		transparent: true,
		side: DoubleSide,
	} );

	curtain = new Mesh( new PlaneGeometry( 2.4, 2.4 ), curtainMaterial );
	curtain.rotation.x = - Math.PI / 2;
	curtain.position.y = 0.3;

	scene.add( floor, wall, curtain );
	pathTracer.setScene( scene, camera );

	loader.setPercentage( 1 );
	onParamsChange();
	onResize();

	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	gui.add( params, 'opacity', 0, 1 ).onChange( onParamsChange );
	gui.add( params, 'curtain' ).onChange( onParamsChange );
	gui.add( params, 'visibleToShadowRays' ).onChange( onParamsChange );
	gui.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );

	animate();

}

function onParamsChange() {

	curtainMaterial.opacity = params.opacity;
	curtain.visible = params.curtain;
	curtain.visibleToShadowRays = params.visibleToShadowRays;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.updateMaterials();
	pathTracer.updateTransforms();

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

	pathTracer.renderSample();

}
