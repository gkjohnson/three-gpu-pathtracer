import { Scene, SphereGeometry, MeshStandardMaterial, Mesh, PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';

const options = {
	enable: true,
	useMegakernel: true,
	isWebGPU: true,
};

// init scene
const scene = new Scene();

// build an 11x11 grid of spheres:
// roughness increases left to right
// metalness increases top to bottom
const sphereGeom = new SphereGeometry( 0.4, 100, 50 );
for ( let x = 0; x <= 10; x ++ ) {

	for ( let y = 0; y <= 10; y ++ ) {

		const mesh = new Mesh(
			sphereGeom,
			new MeshStandardMaterial( {
				color: 0xffffff,
				roughness: x / 10,
				metalness: y / 10,
			} )
		);

		mesh.position.x = x - 5;
		mesh.position.y = 5 - y;
		scene.add( mesh );

	}

}

const texture = new GradientEquirectTexture();
texture.topColor.set( 0xcccccc );
texture.bottomColor.set( 0xcccccc );
texture.update();

scene.environment = texture;
scene.background = texture;

const camera = new PerspectiveCamera( 40, 1, 1, 100 );
camera.position.set( 0, 0, 18 );

let renderer;
let pathTracer;

function createRendererAndPathTracer() {

	if ( renderer ) {

		renderer.dispose();
		pathTracer.dispose();
		document.body.removeChild( renderer.domElement );

	}

	if ( options.isWebGPU ) {

		renderer = new WebGPURenderer( { antialias: true, trackTimestamp: false } );
		renderer.init();
		pathTracer = new WebGPUPathTracer( renderer );
		pathTracer.useMegakernel( options.useMegakernel );

	} else {

		renderer = new WebGLRenderer( { antialias: true } );
		pathTracer = new WebGLPathTracer( renderer );

	}

	document.body.appendChild( renderer.domElement );
	renderer.setSize( innerWidth, innerHeight );
	renderer.setPixelRatio( devicePixelRatio );
	renderer.setAnimationLoop( animate );
	pathTracer.setScene( scene, camera );
	pathTracer.reset();

}

createRendererAndPathTracer();

const gui = new GUI();
gui.add( options, 'enable' );
const megakernelController = gui.add( options, 'useMegakernel' ).onChange( () => {

	if ( options.isWebGPU ) {

		pathTracer.useMegakernel( options.useMegakernel );

	}

	pathTracer.setScene( scene, camera );
	pathTracer.reset();

} );
gui.add( options, 'isWebGPU' ).onChange( () => {

	createRendererAndPathTracer();

	if ( ! options.isWebGPU ) {

		megakernelController.hide();

	} else {

		megakernelController.show();

	}

} );

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

}
