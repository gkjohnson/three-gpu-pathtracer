import { Scene, SphereGeometry, MeshPhysicalMaterial, Mesh, PerspectiveCamera, WebGPURenderer, Color } from 'three/webgpu';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';

// material properties that can be assigned to a grid axis
const AXIS_PROPERTIES = [ 'metalness', 'roughness', 'diffuse roughness', 'iridescence', 'clearcoat', 'thin wall transmission', 'volume transmission', 'opacity', 'none' ];

const options = {
	enable: true,
	useMegakernel: false,
	multipleImportanceSampling: true,
	whiteBackground: false,
	bounces: 15,
	xAxis: 'roughness',
	yAxis: 'metalness',
};

// renderers
const renderer = new WebGPURenderer( { antialias: true, trackTimestamp: false } );
renderer.init();

const pathTracer = new WebGPUPathTracer( renderer );
pathTracer.useMegakernel( options.useMegakernel );
pathTracer.setMultipleImportanceSampling( options.multipleImportanceSampling );
pathTracer.bounces = options.bounces;

document.body.appendChild( renderer.domElement );
renderer.setSize( innerWidth, innerHeight );
renderer.setPixelRatio( devicePixelRatio );
renderer.setAnimationLoop( animate );
pathTracer.reset();

// init scene
const scene = new Scene();

// build an 11x11 grid of spheres: the property assigned to each axis increases
// from 0 to 1 across the grid ( x: left to right, y: top to bottom )
const sphereGeom = new SphereGeometry( 0.4, 100, 50 );
let spheres = [];

const texture = new GradientEquirectTexture();
texture.topColor.set( 0xcccccc );
texture.bottomColor.set( 0xcccccc );
texture.update();

scene.environment = texture;

const camera = new PerspectiveCamera( 40, 1, 1, 100 );
camera.position.set( 0, 0, 18 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.addEventListener( 'change', () => {

	pathTracer.updateCamera();

} );

const gui = new GUI();
gui.add( options, 'enable' );
gui.add( options, 'useMegakernel' ).onChange( () => {

	pathTracer.useMegakernel( options.useMegakernel );
	pathTracer.setScene( scene, camera );
	pathTracer.reset();

} );
gui.add( options, 'multipleImportanceSampling' ).onChange( () => {

	pathTracer.setMultipleImportanceSampling( options.multipleImportanceSampling );

} );
gui.add( options, 'whiteBackground' ).onChange( updateBackground );
gui.add( options, 'bounces', 1, 100, 1 ).onChange( () => {

	pathTracer.bounces = options.bounces;
	pathTracer.reset();

} );
gui.add( options, 'xAxis', AXIS_PROPERTIES ).onChange( rebuild );
gui.add( options, 'yAxis', AXIS_PROPERTIES ).onChange( rebuild );

function rebuild() {

	buildGrid();
	pathTracer.setScene( scene, camera );
	pathTracer.reset();

}

rebuild();
updateBackground();
onResize();
window.addEventListener( 'resize', onResize );

function animate() {

	if ( options.enable ) {

		if ( ! pathTracer.dynamicLowRes && pathTracer.fadeState !== 1 ) {

			renderer.render( scene, camera );

		}

		pathTracer.renderSample();

	} else {

		renderer.render( scene, camera );

	}

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();
	pathTracer.updateCamera();

}

function updateBackground() {

	scene.background = new Color( options.whiteBackground ? 'white' : '#ccc' );
	pathTracer.updateEnvironment();

}

function buildGrid() {

	spheres.forEach( mesh => {

		scene.remove( mesh );
		mesh.material.dispose();

	} );
	spheres = [];

	const xCount = options.xAxis === 'none' ? 1 : 11;
	const yCount = options.yAxis === 'none' ? 1 : 11;
	for ( let x = 0; x < xCount; x ++ ) {

		for ( let y = 0; y < yCount; y ++ ) {

			const material = new MeshPhysicalMaterial( {
				color: 0xffffff,
				roughness: 0.5,
				clearcoat: 0.0,
				clearcoatRoughness: 1.0,
				iridescence: 0.0,
				metalness: 0.0,
				transmission: 0.0,
			} );


			setField( material, options.xAxis, x / ( xCount - 1 ) );
			setField( material, options.yAxis, y / ( yCount - 1 ) );

			const mesh = new Mesh( sphereGeom, material );
			mesh.position.x = x - ( xCount / 2 ) + 0.5;
			mesh.position.y = ( yCount / 2 ) - y - 0.5;
			scene.add( mesh );
			spheres.push( mesh );


		}

	}

	function setField( material, field, val ) {

		if ( field === 'metalness' ) {

			material.metalness = val;

		} else if ( field === 'roughness' ) {

			material.roughness = val;

		} else if ( field === 'diffuse roughness' ) {

			material.diffuseRoughness = val;

		} else if ( field === 'iridescence' ) {

			material.iridescence = val;

		} else if ( field === 'clearcoat' ) {

			material.clearcoat = 1.0;
			material.clearcoatRoughness = val;

		} else if ( field === 'thin wall transmission' ) {

			material.transmission = val;

		} else if ( field === 'volume transmission' ) {

			// any non zero thickness marks the material as a solid volume in the path tracer
			material.transmission = val;
			material.thickness = 1.0;

		} else if ( field === 'opacity' ) {

			material.transparent = true;
			material.opacity = val;

		}

	}

}
