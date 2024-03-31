import {
	ACESFilmicToneMapping,
	PerspectiveCamera,
	OrthographicCamera,
	Group,
	Box3,
	Vector3,
	EquirectangularReflectionMapping,
	Scene,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EquirectCamera, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let pathTracer, renderer, controls, sphericalControls, activeCamera, scene;
let perspectiveCamera, orthoCamera, equirectCamera;
let samplesEl;
const params = {

	environmentIntensity: 0,
	environmentRotation: 0,
	emissiveIntensity: 12,
	bounces: 20,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
	tiles: 2,
	cameraProjection: 'Perspective'

};

const orthoWidth = 5;

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.min( params.bounces, 10 );
	params.resolutionScale *= 0.5;
	params.tiles = 3;

}

init();

async function init() {

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.dynamicLowRes = true;
	pathTracer.tiles.set( params.tiles, params.tiles );

	perspectiveCamera = new PerspectiveCamera( 75, aspectRatio, 0.025, 500 );
	perspectiveCamera.position.set( 0.4, 0.6, 2.65 );

	const orthoHeight = orthoWidth / aspectRatio;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.copy( perspectiveCamera.position );

	// Almost, but not quite on top of the control target.
	// This allows for full rotation without moving the camera very much.
	equirectCamera = new EquirectCamera();
	equirectCamera.position.set( - 0.2, 0.33, 0.08 );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.target.set( - 0.15, 0.33, - 0.08 );
	perspectiveCamera.lookAt( controls.target );
	controls.update();
	controls.addEventListener( 'change', () => {

		pathTracer.setScene( activeCamera, scene );

	} );

	sphericalControls = new OrbitControls( equirectCamera, renderer.domElement );
	sphericalControls.target.set( - 0.15, 0.33, - 0.08 );
	equirectCamera.lookAt( sphericalControls.target );
	sphericalControls.update();
	sphericalControls.addEventListener( 'change', () => {

		pathTracer.setScene( activeCamera, scene );

	} );

	samplesEl = document.getElementById( 'samples' );

	scene = new Scene();

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' )
		.then( texture => {

			texture.mapping = EquirectangularReflectionMapping;
			scene.background = texture;
			scene.environment = texture;

		} );

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/pathtracing-bathroom/modernbathroom.glb' )
		.then( gltf => {

			gltf.scene.traverse( c => {

				if ( c.material ) {

					// set the thickness so volume rendering is used for transmissive objects.
					c.material.thickness = 1.0;

				}

			} );

			const group = new Group();
			group.add( gltf.scene );

			const box = new Box3();
			box.setFromObject( gltf.scene );

			group.updateMatrixWorld();

			const center = new Vector3();
			box.getCenter( center );

			gltf.scene.position.addScaledVector( center, - 0.5 );
			group.updateMatrixWorld();

			scene.add( group );

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );
	pathTracer.setScene( perspectiveCamera, scene );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'filterGlossyFactor', 0, 1 ).onChange( reset );
	gui.add( params, 'environmentIntensity', 0, 25 ).onChange( reset );
	gui.add( params, 'environmentRotation', 0, 40 ).onChange( reset );
	gui.add( params, 'emissiveIntensity', 0, 50 ).onChange( reset );
	gui.add( params, 'bounces', 1, 30, 1 ).onChange( reset );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );
	gui.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic', 'Equirectangular' ] ).onChange( reset );

	updateIntensity();
	reset();

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const aspect = w / h;

	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

	reset();

}

function updateIntensity() {

	scene.traverse( c => {

		const material = c.material;
		if ( material ) {

			material.emissiveIntensity = params.emissiveIntensity;

		}

	} );

}

function reset() {

	updateIntensity();

	const cameraProjection = params.cameraProjection;
	if ( cameraProjection === 'Perspective' ) {

		if ( activeCamera === orthoCamera ) {

			perspectiveCamera.position.copy( activeCamera.position );

		}

		activeCamera = perspectiveCamera;
		controls.object = activeCamera;

	} else if ( cameraProjection === 'Orthographic' ) {

		if ( activeCamera === perspectiveCamera ) {

			orthoCamera.position.copy( activeCamera.position );

		}

		activeCamera = orthoCamera;
		controls.object = activeCamera;

	}

	if ( cameraProjection === 'Equirectangular' ) {

		activeCamera = equirectCamera;

		controls.enabled = false;
		sphericalControls.enabled = true;

		sphericalControls.update();

	} else {

		sphericalControls.enabled = false;
		controls.enabled = true;

		controls.update();

	}

	pathTracer.renderScale = params.resolutionScale;

	scene.environmentRotation.y = params.environmentRotation;
	scene.backgroundRotation.y = params.environmentRotation;
	scene.environmentIntensity = params.environmentIntensity;
	scene.backgroundIntensity = params.environmentIntensity;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;

	pathTracer.setScene( activeCamera, scene );

}

function animate() {

	requestAnimationFrame( animate );

	activeCamera.updateMatrixWorld();
	pathTracer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}




