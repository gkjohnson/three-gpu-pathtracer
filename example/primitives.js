import { Scene, SphereGeometry, MeshStandardMaterial, Mesh, BoxGeometry, PerspectiveCamera, ACESFilmicToneMapping, WebGLRenderer } from 'three';
import { WebGLPathTracer, GradientEquirectTexture } from '..';

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
	new MeshStandardMaterial(),
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

const renderer = new WebGLRenderer( { antialias: true } );
const pathTracer = new WebGLPathTracer( renderer );
document.body.appendChild( pathTracer.domElement );
pathTracer.toneMapping = ACESFilmicToneMapping;
pathTracer.tiles.set( 3, 3 );
pathTracer.updateScene( camera, scene );

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

	// update rendering resolution
	const w = window.innerWidth;
	const h = window.innerHeight;

	pathTracer.setSize( w, h );
	pathTracer.setPixelRatio( window.devicePixelRatio );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

}
