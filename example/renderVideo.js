import {
	Vector3,
	WebGPURenderer,
	ACESFilmicToneMapping,
	Scene,
	PerspectiveCamera,
	EquirectangularReflectionMapping,
	AnimationMixer,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import {
	BufferTarget,
	CanvasSource,
	Output,
	WebMOutputFormat,
} from 'mediabunny';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/phalzer_forest_01_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/bao-robot/bao-robot.glb';
const CREDITS = 'Model by DailyArt on Sketchfab';

let pathTracer, renderer, controls, camera, scene, gui, mixer;
let videoEl;
let recordedFrames = 0;
let animationDuration = 0;
let videoUrl = '';
let loader;
let videoOutput, videoSource;
let isWritingFrame = false;
let recordingState = 'idle';
const UP_AXIS = new Vector3( 0, 1, 0 );

const params = {

	displayVideo: false,

	tiles: 2,
	rotation: 2 * Math.PI,
	duration: 0,
	frameRate: 12,
	samples: 20,
	record: startRecording,
	stop: finishRecording,

	bounces: 5,
	samplesPerFrame: 1,
	renderScale: 1,
	...getScaledSettings(),

};

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.25;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.renderDelay = 0;
	pathTracer.minSamples = 1;

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.1;

	// camera
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5, 8, 12 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 4.5, - 0.08 );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// get dom elements
	videoEl = document.getElementsByTagName( 'video' )[ 0 ];
	videoEl.style.display = 'none';

	// load assets
	const [ envTexture, gltf ] = await Promise.all( [
		new HDRLoader().loadAsync( ENV_URL ),
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL ),
	] );

	envTexture.mapping = EquirectangularReflectionMapping;
	scene.background = envTexture;
	scene.environment = envTexture;

	// fix the material state
	gltf.scene.traverse( c => {

		if ( c.material ) {

			c.material.transparent = false;
			c.material.depthWrite = true;

		}

	} );
	gltf.scene.scale.setScalar( 0.3 );
	scene.add( gltf.scene );

	// add floor
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

	// initialize animations
	const animations = gltf.animations;
	const clip = animations[ 0 ];
	mixer = new AnimationMixer( gltf.scene );
	mixer.clipAction( clip ).play();

	// save the duration of the animation
	animationDuration = parseFloat( clip.duration.toFixed( 2 ) );
	params.duration = animationDuration;

	// prep for rendering
	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );
	pathTracer.setScene( scene, camera );

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
	const recording = recordingState !== 'idle';
	animationFolder.add( params, 'rotation', - 2 * Math.PI, 2 * Math.PI ).disable( recording );
	animationFolder.add( params, 'duration', 0.25, animationDuration, 1e-2 ).disable( recording );
	animationFolder.add( params, 'frameRate', 12, 60, 1 ).disable( recording );
	animationFolder.add( params, 'renderScale', 0.1, 1 ).onChange( regenerateScene ).disable( recording );
	animationFolder.add( params, recording ? 'stop' : 'record' ).disable( recordingState !== 'idle' && recordingState !== 'recording' );

	// dynamic parameters
	const renderFolder = gui.addFolder( 'rendering' );
	renderFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	renderFolder.add( params, 'samples', 1, 500, 1 );
	renderFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	renderFolder.add( params, 'bounces', 1, 10, 1 ).onChange( regenerateScene );

}

function initializeSize() {

	// only size this once because we don't want it to change during rendering
	const w = Math.min( 700, window.innerWidth );
	const h = Math.floor( w * 3 / 4 );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h, false );
	renderer.setPixelRatio( window.devicePixelRatio );

	// update the dom elements
	renderer.domElement.style.width = `${ w }px`;
	videoEl.style.width = `${ w }px`;

	pathTracer.updateCamera();

}

function regenerateScene() {

	pathTracer.renderScale = params.renderScale;
	pathTracer.bounces = params.bounces;
	pathTracer.setScene( scene, camera );

}

async function startRecording() {

	if ( recordingState !== 'idle' ) return;

	params.displayVideo = false;
	URL.revokeObjectURL( videoUrl );
	videoUrl = '';
	rebuildGUI();

	try {

		videoOutput = new Output( {
			format: new WebMOutputFormat(),
			target: new BufferTarget(),
		} );

		videoSource = new CanvasSource( renderer.domElement, {
			codec: 'vp9',
			bitrate: 1e7, // high bitrate
			bitrateMode: 'constant',
		} );

		videoOutput.addVideoTrack( videoSource, { frameRate: params.frameRate } );
		await videoOutput.start();

		recordingState = 'recording';
		pathTracer.minSamples = 0;
		recordedFrames = 0;
		regenerateScene();

	} catch ( error ) {

		recordingState = 'idle';
		console.error( error );

	}

	rebuildGUI();

}

async function finishRecording() {

	if ( recordingState !== 'recording' ) return;

	rebuildGUI();

	try {

		// Explicitly close the source for optimized finalization
		await videoSource.close();
		await videoOutput.finalize();

		const blob = new Blob( [ videoOutput.target.buffer ], { type: 'video/webm' } );
		videoUrl = URL.createObjectURL( blob );
		videoEl.src = videoUrl;
		videoEl.play();
		params.displayVideo = true;

	} catch ( error ) {

		console.error( error );

	} finally {

		recordingState = 'idle';
		videoOutput = null;
		videoSource = null;
		isWritingFrame = false;

		pathTracer.minSamples = 1;
		pathTracer.reset();
		recordedFrames = 0;
		rebuildGUI();

	}

}

function advanceAnimation() {

	const totalFrames = Math.ceil( params.frameRate * params.duration );
	const angle = params.rotation / totalFrames;
	camera.position.applyAxisAngle( UP_AXIS, angle );
	controls.update();
	camera.updateMatrixWorld();

	mixer.update( 1 / params.frameRate );
	regenerateScene();

}

async function writeVideoFrame() {

	isWritingFrame = true;
	const frameDuration = 1 / params.frameRate;

	try {

		// Mediabunny automatically aligns timestamps given the current frame offset and duration
		await videoSource.add( recordedFrames * frameDuration, frameDuration );
		recordedFrames ++;

		if ( recordingState !== 'recording' ) return;

		const totalFrames = Math.ceil( params.frameRate * params.duration );
		if ( recordedFrames >= totalFrames ) {

			await finishRecording();

		} else {

			advanceAnimation();

		}

	} catch ( error ) {

		console.error( error );
		await finishRecording();

	} finally {

		isWritingFrame = false;

	}

}

function animate() {

	requestAnimationFrame( animate );

	const isRecording = recordingState === 'recording';
	const displayingVideo = params.displayVideo && ! isRecording && videoUrl !== '';
	if ( displayingVideo ) {

		videoEl.style.display = 'inline-block';

	} else {

		videoEl.style.display = 'none';
		controls.enabled = recordingState === 'idle';

		camera.updateMatrixWorld();

		for ( let i = 0; ! isWritingFrame && i < params.samplesPerFrame; i ++ ) {

			pathTracer.renderSample();

			// Break when reaching the target sample count to avoid extra samples
			if ( isRecording && pathTracer.samples >= params.samples ) {

				break;

			}

		}

		// If recording and target samples are reached, write the video frame and advance the animation
		if ( isRecording && ! isWritingFrame && pathTracer.samples >= params.samples ) {

			writeVideoFrame();

		}

	}

	// update the stats display
	if ( isRecording ) {

		const total = Math.ceil( params.frameRate * params.duration );
		const percStride = 1 / total;
		const samplesPerc = pathTracer.samples / params.samples;
		const percentDone = ( samplesPerc + recordedFrames ) * percStride;
		loader.setPercentage( percentDone );

	} else {

		loader.setPercentage( 1 );
		loader.setSamples( pathTracer.samples, pathTracer.getDetailedSampleCount() );

	}

}
