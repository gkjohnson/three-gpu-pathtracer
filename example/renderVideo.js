import {
	Vector3,
	WebGLRenderer,
	ACESFilmicToneMapping,
	Scene,
	PerspectiveCamera,
	EquirectangularReflectionMapping,
	AnimationMixer,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import CanvasCapture from 'canvas-capture';

// CCapture seems to replace the requestAnimationFrame callback which breaks the ability to render and
// use CanvasCapture.
const requestAnimationFrame = window.requestAnimationFrame;

let renderer, controls, camera, scene, gui, model, pathTracer;
let samplesEl, videoEl;
let recordedFrames = 0;
let animationDuration = 0;
let videoUrl = '';
const UP_AXIS = new Vector3( 0, 1, 0 );

const params = {

	displayVideo: false,

	tiles: 2,
	rotation: 2 * Math.PI,
	duration: 0,
	frameRate: 12,
	samples: 20,
	record: () => {

		// hide the video and revoke any existing blob on record stat
		params.displayVideo = false;
		URL.revokeObjectURL( videoUrl );

		// begin recording
		CanvasCapture.init( renderer.domElement );
		CanvasCapture.beginVideoRecord( {
			format: CanvasCapture.WEBM,
			fps: params.frameRate,
			onExport: blob => {

				videoUrl = URL.createObjectURL( blob );
				videoEl.src = videoUrl;
				videoEl.play();

				params.displayVideo = true;
				rebuildGUI();

			}
		} );

		// reinitialize recording variables
		pathTracer.reset();
		recordedFrames = 0;
		rebuildGUI();

	},
	stop: () => {

		CanvasCapture.stopRecord();
		recordedFrames = 0;
		rebuildGUI();

	},

	bounces: 5,
	samplesPerFrame: 1,
	resolutionScale: 1,

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
	renderer = new WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.25;
	pathTracer.tiles.set( params.tiles, params.tiles );

	scene = new Scene();
	scene.backgroundBlurriness = 0.1;

	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5, 8, 12 );

	// initialize controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 4.5, - 0.08 );
	controls.addEventListener( 'change', () => {

		pathTracer.reset();

	} );
	controls.update();

	// get dom elements
	samplesEl = document.getElementById( 'samples' );

	videoEl = document.getElementsByTagName( 'video' )[ 0 ];
	videoEl.style.display = 'none';

	// model models and environment map
	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/phalzer_forest_01_1k.hdr' )
		.then( texture => {

			texture.mapping = EquirectangularReflectionMapping;
			scene.background = texture;
			scene.environment = texture;

		} );

	const modelPromise = await loadModel( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/bao-robot/bao-robot.glb' )
		.then( result => {

			model = result;
			regenerateScene();

		} );

	await Promise.all( [ envMapPromise, modelPromise ] );

	// prep for rendering
	document.getElementById( 'loading' ).remove();

	initializeSize();
	rebuildGUI();

	animate();

}

function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();
	gui.add( params, 'displayVideo' ).disable( videoUrl === '' );

	// animation folder with parameters that are locked during animation
	const animationFolder = gui.addFolder( 'animation' );
	const recording = CanvasCapture.isRecording();
	animationFolder.add( params, 'rotation', - 2 * Math.PI, 2 * Math.PI ).disable( recording );
	animationFolder.add( params, 'duration', 0.25, animationDuration, 1e-2 ).disable( recording );
	animationFolder.add( params, 'frameRate', 12, 60, 1 ).disable( recording );
	animationFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( regenerateScene ).disable( recording );
	animationFolder.add( params, recording ? 'stop' : 'record' );

	// dynamic parameters
	const renderFolder = gui.addFolder( 'rendering' );
	renderFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	renderFolder.add( params, 'samples', 1, 500, 1 );
	renderFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	renderFolder.add( params, 'bounces', 1, 10, 1 ).onChange( regenerateScene );

}

function loadModel( url ) {

	// load the gltf model
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( gltf => {

			// make the model white since the texture seems to dark for the env map
			// TODO: remove this
			gltf.scene.traverse( c => {

				if ( c.material ) {

					c.material.transparent = false;
					c.material.depthWrite = true;

				}

			} );
			gltf.scene.scale.setScalar( 0.3 );

			// initialize animations
			const animations = gltf.animations;
			const mixer = new AnimationMixer( gltf.scene );
			const clip = animations[ 0 ];
			const action = mixer.clipAction( clip );
			action.play();

			// save the duration of the animation
			animationDuration = parseFloat( clip.duration.toFixed( 2 ) );
			params.duration = animationDuration;

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
					metalness: 0.95
				} )
			);
			floorPlane.scale.setScalar( 50 );
			floorPlane.rotation.x = - Math.PI / 2;
			floorPlane.position.y = 0.075;
			scene.add( floorPlane );

			// create the scene generator for updating skinned meshes quickly
			return {
				mixer,
				action,
			};

		} );

	return gltfPromise;

}

function initializeSize() {

	// only size this once because we don't want it to change during rendering
	const w = Math.min( 700, window.innerWidth );
	const h = Math.floor( w * 3 / 4 );
	const dpr = window.devicePixelRatio;

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h, false );
	renderer.setPixelRatio( dpr );

	// update the dom elements
	renderer.domElement.style.width = `${ w }px`;
	videoEl.style.width = `${ w }px`;

}

function regenerateScene() {

	pathTracer.renderScale = params.resolutionScale;
	pathTracer.bounces = params.bounces;
	pathTracer.updateScene( camera, scene );

}

function animate() {

	requestAnimationFrame( animate );

	const isRecording = CanvasCapture.isRecording();
	const displayingVideo = params.displayVideo && ! isRecording && videoUrl !== '';
	if ( displayingVideo ) {

		videoEl.style.display = 'inline-block';

	} else {

		videoEl.style.display = 'none';
		controls.enabled = ! isRecording;

		camera.updateMatrixWorld();

		// if we're recording and we hit the target samples then record the frame step the animation forward
		if ( isRecording && pathTracer.samples >= params.samples ) {

			CanvasCapture.recordFrame();
			recordedFrames ++;

			//  stop recording if we've hit enough frames
			if ( recordedFrames >= params.frameRate * params.duration ) {

				CanvasCapture.stopRecord();

				recordedFrames = 0;
				rebuildGUI();

			}

			// update the camera transform and update the geometry
			const angle = params.rotation / Math.ceil( params.frameRate * animationDuration );
			camera.position.applyAxisAngle( UP_AXIS, angle );
			controls.update();
			camera.updateMatrixWorld();

			const delta = 1 / params.frameRate;
			model.mixer.update( delta );

			regenerateScene();

		}

		pathTracer.renderSample();

	}

	// update the stats display
	if ( isRecording ) {

		const total = Math.ceil( params.frameRate * params.duration );
		const percStride = 1 / total;
		const samplesPerc = pathTracer.samples / params.samples;
		const percentDone = ( samplesPerc + recordedFrames ) * percStride;
		samplesEl.innerText = `Frame Samples        : ${ Math.floor( pathTracer.samples ) }\n`;
		samplesEl.innerText += `Frames Rendered      : ${ recordedFrames } / ${ total }\n`;
		samplesEl.innerText += `Rendering Completion : ${ ( percentDone * 100 ).toFixed( 2 ) }%`;

	} else {

		samplesEl.innerText = '';
		samplesEl.innerText += `Samples : ${ Math.floor( pathTracer.samples ) }`;

	}

}
