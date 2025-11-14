import { Scene, SphereGeometry, MeshStandardMaterial, Mesh, BoxGeometry, PerspectiveCamera, ACESFilmicToneMapping, WebGPURenderer } from 'three/webgpu';
import { WebGPUPathTracer, GradientEquirectTexture } from '../src/index.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';

const options = {
	useMegakernel: true,
};

// init scene, renderer, camera, controls, etc
const scene = new Scene();
const sphereGeom = new SphereGeometry( 0.49, 64, 32 );
const ball1 = new Mesh(
	sphereGeom,
	new MeshStandardMaterial( {
		color: '#e91e63',
		roughness: 0.25,
		metalness: 1,
	} )
);
const ball2 = new Mesh(
	sphereGeom,
	new MeshStandardMaterial( {
		color: '#ff9800',
		roughness: 0.1,
		metalness: 1,
	} )
);
const ball3 = new Mesh(
	sphereGeom,
	new MeshStandardMaterial( {
		color: '#2196f3',
		roughness: 0.2,
		metalness: 1,
	} )
);
const ground = new Mesh(
	new BoxGeometry( 3.5, 0.1, 1.5 ),
	new MeshStandardMaterial( { color: '#f0f0f0' } ),
);

ball1.position.x = - 1;
ball3.position.x = 1;
ground.position.y = - 0.54;
scene.add( ball1, ball2, ball3, ground );

// set the environment map
const texture = new GradientEquirectTexture();
texture.bottomColor.set( 0xffffff );
texture.bottomColor.set( 0x666666 );
texture.update();
scene.environment = texture;
scene.background = texture;

const camera = new PerspectiveCamera();
camera.position.set( 0, 1, - 5 );
camera.lookAt( 0, 0, 0 );

const renderer = new WebGPURenderer( { antialias: true } );
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild( renderer.domElement );
renderer.setDrawingBufferSize( 1920, 1080, 1 );

const settings = getScaledSettings();
const pathTracer = new WebGPUPathTracer( renderer );
pathTracer.renderScale = settings.renderScale;
pathTracer.tiles.setScalar( settings.tiles );
pathTracer.setScene( scene, camera );

const gui = new GUI();

gui.add( options, 'useMegakernel' ).onChange( () => {

	pathTracer.useMegakernel( options.useMegakernel );

} );


onResize();

animate();

window.addEventListener( 'resize', onResize );

function animate() {

	// if the camera position changes call "ptRenderer.reset()"
	requestAnimationFrame( animate );

	// update the camera and render one sample
	pathTracer.renderSample();

}

function onResize() {

	return;
	// update rendering resolution
	const w = window.innerWidth;
	const h = window.innerHeight;

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	pathTracer.setScene( scene, camera );

}
