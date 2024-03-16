import * as THREE from 'three';
import { WebGLPathTracer, GradientEquirectTexture } from '..';

// init scene, renderer, camera, controls, etc
const scene = new THREE.Scene();
const sphereGeom = new THREE.SphereGeometry( 0.49, 64, 32 );
const ball1 = new THREE.Mesh(
	sphereGeom,
	new THREE.MeshStandardMaterial( {
		color: '#e91e63',
		roughness: 0.25,
		metalness: 1,
	} )
);
const ball2 = new THREE.Mesh(
	sphereGeom,
	new THREE.MeshStandardMaterial( {
		color: '#ff9800',
		roughness: 0.1,
		metalness: 1,
	} )
);
const ball3 = new THREE.Mesh(
	sphereGeom,
	new THREE.MeshStandardMaterial( {
		color: '#2196f3',
		roughness: 0.2,
		metalness: 1,
	} )
);
const ground = new THREE.Mesh(
	new THREE.BoxGeometry( 3.5, 0.1, 1.5 ),
	new THREE.MeshStandardMaterial(),
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

// ensure scene matrices are up to date
scene.updateMatrixWorld();

const { innerWidth, innerHeight, devicePixelRatio } = window;
const camera = new THREE.PerspectiveCamera();
camera.aspect = innerWidth / innerHeight;
camera.position.set( 0, 1, - 5 );
camera.lookAt( 0, 0, 0 );
camera.updateProjectionMatrix();

const renderer = new WebGLPathTracer();
document.body.appendChild( renderer.domElement );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio( devicePixelRatio );
renderer.setSize( innerWidth, innerHeight );
renderer.setClearColor( 0xaaaaaa );
renderer.tiles.set( 3 );
renderer.updateScene( camera, scene );

// // initialize the path tracing material and renderer
// const ptMaterial = new PhysicalPathTracingMaterial();
// const ptRenderer = new PathTracingRenderer( renderer );
// ptRenderer.setSize( innerWidth * devicePixelRatio, innerHeight * devicePixelRatio );
// ptRenderer.tiles.setScalar( 3 );
// ptRenderer.camera = camera;
// ptRenderer.material = ptMaterial;

// // init quad for rendering to the canvas
// const fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
// 	map: ptRenderer.target.texture,
// 	blending: THREE.CustomBlending,
// } ) );

// // initialize the scene and update the material properties with the bvh, materials, etc
// const generator = new PathTracingSceneGenerator();
// const { bvh, textures, materials, lights, geometry } = generator.generate( scene );

// // update bvh and geometry attribute textures
// ptMaterial.bvh.updateFrom( bvh );
// ptMaterial.attributesArray.updateFrom(
// 	geometry.attributes.normal,
// 	geometry.attributes.tangent,
// 	geometry.attributes.uv,
// 	geometry.attributes.color,
// );

// // update materials and texture arrays
// ptMaterial.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
// ptMaterial.textures.setTextures( renderer, 2048, 2048, textures );
// ptMaterial.materials.updateFrom( materials, textures );

// // update the lights
// ptMaterial.lights.updateFrom( lights );

animate();

window.addEventListener( 'resize', () => {

	// update rendering resolution
	const w = window.innerWidth;
	const h = window.innerHeight;

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

} );

function animate() {

	// if the camera position changes call "ptRenderer.reset()"
	requestAnimationFrame( animate );

	// update the camera and render one sample
	camera.updateMatrixWorld();
	renderer.renderSample();

}
