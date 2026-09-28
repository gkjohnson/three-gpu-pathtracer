import { Scene, SphereGeometry, MeshStandardMaterial, Mesh, BoxGeometry, PerspectiveCamera, ACESFilmicToneMapping, WebGPURenderer } from 'three/webgpu';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// init scene
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
texture.topColor.set( 0xffffff );
texture.bottomColor.set( 0x666666 );
texture.update();
scene.environment = texture;
scene.background = texture;

// camera
const camera = new PerspectiveCamera();
camera.position.set( 0, 1, - 5 );
camera.lookAt( 0, 0, 0 );

// renderer
const renderer = new WebGPURenderer( { antialias: true } );
renderer.init();
renderer.toneMapping = ACESFilmicToneMapping;
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );

// path tracer
const pathTracer = new WebGPUPathTracer( renderer );
pathTracer.setScene( scene, camera );

// controls
const controls = new OrbitControls( camera, renderer.domElement );
controls.addEventListener( 'change', () => pathTracer.updateCamera() );

onResize();
window.addEventListener( 'resize', onResize );

function animate() {

	// render one path traced sample
	pathTracer.renderSample();

}

function onResize() {

	// update rendering resolution
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}
