import {
	WebGLRenderer,
	ACESFilmicToneMapping,
	Scene,
	PerspectiveCamera,
	Clock,
	AnimationMixer,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlurredEnvMapGenerator, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';

let renderer, controls, camera, scene, clock;
let samplesEl, pathTracer, mixer, mixerAction;
let counter = 0;
const params = {

	environmentIntensity: 1,
	bounces: 5,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	tiles: 1,
	autoPause: true,
	pause: false,
	continuous: false,

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.resolutionScale *= 0.5;
	params.tiles = 2;

}

init();

async function init() {

	// initialize renderer, scene, camera
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.multipleImportanceSampling = false;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.filterGlossyFactor = 0.25;

	scene = new Scene();

	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5.5, 3.5, 7.5 );

	// initialize controls
	controls = new OrbitControls( camera, renderer.domElement );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => {

		regenerateScene();

	} );
	controls.update();

	samplesEl = document.getElementById( 'samples' );

	clock = new Clock();

	// loading the
	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr' )
		.then( texture => {

			const generator = new BlurredEnvMapGenerator( renderer );
			const blurredTex = generator.generate( texture, 0.1 );
			generator.dispose();

			scene.background = blurredTex;
			scene.environment = blurredTex;

		} );

	let modelPromise;
	if ( window.location.hash === '#morphtarget' ) {

		modelPromise = loadModel( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb' );

	} else {

		modelPromise = loadModel( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf' );

	}

	await Promise.all( [ envMapPromise, modelPromise ] );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	// init gui
	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		pathTracer.reset();

	} );
	gui.add( params, 'bounces', 1, 10, 1 ).onChange( () => {

		pathTracer.reset();

	} );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( v => {

		pathTracer.renderScale = v;
		pathTracer.reset();

	} );
	gui.add( params, 'autoPause' ).listen();
	gui.add( params, 'pause' ).onChange( v => {

		params.autoPause = false;
		setPause( v );

	} ).listen();
	gui.add( params, 'continuous' ).onChange( () => {

		params.autoPause = false;

	} );

	animate();

}

function setPause( v ) {

	mixerAction.paused = v;
	params.pause = v;
	if ( v ) {

		regenerateScene();

	}

}

function loadModel( url ) {

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( gltf => {

			// animations
			const animations = gltf.animations;
			mixer = new AnimationMixer( gltf.scene );

			mixerAction = mixer.clipAction( animations[ 0 ] );
			mixerAction.play();
			mixerAction.paused = params.pause;

			// add floor
			scene.add( gltf.scene );

			const floorTex = generateRadialFloorTexture( 2048 );
			const floorPlane = new Mesh(
				new PlaneGeometry(),
				new MeshStandardMaterial( {
					map: floorTex,
					transparent: true,
					color: 0xdddddd,
					roughness: 0.15,
					metalness: 1.0
				} )
			);
			floorPlane.scale.setScalar( 50 );
			floorPlane.rotation.x = - Math.PI / 2;
			floorPlane.position.y = 0.075;
			scene.add( floorPlane );

		} );

	return gltfPromise;

}


function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	pathTracer.setSize( w, h );
	pathTracer.setPixelRatio( dpr );

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	regenerateScene();

}

function regenerateScene() {

	scene.environmentIntensity = params.environmentIntensity;
	pathTracer.bounces = params.bounces;
	pathTracer.updateScene( camera, scene );

}

function animate() {

	requestAnimationFrame( animate );

	// step the animation forward
	const delta = Math.min( clock.getDelta(), 30 * 0.001 );
	mixer.update( delta );

	if ( params.autoPause ) {

		// auto pause the animation
		counter += delta;
		if ( ! params.pause && counter >= 2.5 || params.pause && counter >= 5 ) {

			setPause( ! params.pause );
			counter = 0;

		}

	} else {

		counter = 0;

	}

	if ( ! params.pause && ! params.continuous ) {

		renderer.render( scene, camera );

	} else {

		// if we're continuously path tracing then update the scene
		if ( ! params.pause && params.continuous ) {

			regenerateScene();

		}

		camera.updateMatrixWorld();
		pathTracer.renderSample();

		samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

	}

}
