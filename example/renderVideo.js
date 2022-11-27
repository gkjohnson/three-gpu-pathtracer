import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DynamicPathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import CanvasCapture from 'canvas-capture';

const requestAnimationFrame = window.requestAnimationFrame;

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad, scene, gui, model;
let samplesEl, videoEl;
let recordedFrames = 0;
let animationDuration = 0;
let videoUrl = '';
const UP_AXIS = new THREE.Vector3( 0, 1, 0 );

const params = {

	tiles: 2,
	rotation: 2 * Math.PI,
	duration: 0,
	frameRate: 12,
	samples: 20,
	displayVideo: false,
	record: () => {

		params.displayVideo = false;
		URL.revokeObjectURL( videoUrl );

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

		ptRenderer.reset();
		recordedFrames = 0;
		rebuildGUI();

	},
	stop: () => {

		CanvasCapture.stopRecord();

		recordedFrames = 0;
		rebuildGUI();

	},


	bounces: 3,
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

	renderer = new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5.5, 3.5, 7.5 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.filterGlossyFactor = 0.25;
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		transparent: true,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 2, - 0.08 );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );
	controls.update();

	samplesEl = document.getElementById( 'samples' );
	videoEl = document.getElementsByTagName( 'video' )[ 0 ];
	videoEl.style.display = 'none';

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' )
		.then( texture => {

			ptRenderer.material.envMapInfo.updateFrom( texture );

			texture.mapping = THREE.EquirectangularReflectionMapping;
			scene.background = texture;
			scene.environment = texture;

		} );

	const modelPromise = await loadModel( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf' )
		.then( result => {

			model = result;
			regenerateScene();

		} );

	await Promise.all( [ envMapPromise, modelPromise ] );
	scene.add( model.scene );

	document.getElementById( 'loading' ).remove();

	onResize();
	rebuildGUI();

	animate();

}

function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();
	gui.add( params, 'displayVideo' ).disable( videoUrl === '' );

	const animationFolder = gui.addFolder( 'animation' );

	const recording = CanvasCapture.isRecording();
	animationFolder.add( params, 'rotation', - 2 * Math.PI, 2 * Math.PI ).disable( recording );
	animationFolder.add( params, 'duration', 0.25, animationDuration, 1e-2 ).disable( recording );
	animationFolder.add( params, 'frameRate', 12, 60, 1 ).disable( recording );
	animationFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} ).disable( recording );

	if ( ! recording ) {

		animationFolder.add( params, 'record' );

	} else {

		animationFolder.add( params, 'stop' );

	}

	const renderFolder = gui.addFolder( 'rendering' );
	renderFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	renderFolder.add( params, 'samples', 1, 500, 1 );
	renderFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	renderFolder.add( params, 'bounces', 1, 5, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
}

function loadModel( url ) {

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( gltf => {

			// make the model white since the texture seems to dark for the env map
			gltf.scene.traverse( c => {

				if ( c.material ) {

					c.material.metalness = 0;
					c.material.map = null;

				}

			} );

			// animations
			const animations = gltf.animations;
			const mixer = new THREE.AnimationMixer( gltf.scene );

			const clip = animations[ 0 ];
			const action = mixer.clipAction( clip );
			action.play();

			animationDuration = parseFloat( clip.duration.toFixed( 2 ) );
			params.duration = animationDuration;

			// add floor
			const group = new THREE.Group();
			group.add( gltf.scene );

			const floorTex = generateRadialFloorTexture( 2048 );
			const floorPlane = new THREE.Mesh(
				new THREE.PlaneGeometry(),
				new THREE.MeshStandardMaterial( {
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
			group.add( floorPlane );

			// create the scene generator for updating skinned meshes quickly
			const sceneGenerator = new DynamicPathTracingSceneGenerator( group );

			return {
				scene: group,
				sceneGenerator,
				mixer,
				action,
			};

		} );

	return gltfPromise;

}

function onResize() {

	const w = Math.min( 800, window.innerWidth );
	const h = Math.floor( w * 9 / 16 );
	const scale = params.resolutionScale;
	const dpr = window.devicePixelRatio;

	ptRenderer.setSize( w * scale * dpr, h * scale * dpr );
	ptRenderer.reset();

	renderer.setSize( w, h, false );
	renderer.setPixelRatio( window.devicePixelRatio * scale );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.domElement.style.width = `${ w }px`;
	videoEl.style.width = `${ w }px`;

}

function regenerateScene() {

	const { scene, sceneGenerator } = model;
	scene.updateMatrixWorld( true );
	sceneInfo = sceneGenerator.generate();

	const { bvh, textures, materials } = sceneInfo;
	const geometry = bvh.geometry;
	const material = ptRenderer.material;

	material.bvh.updateFrom( bvh );
	material.attributesArray.updateFrom(
		geometry.attributes.normal,
		geometry.attributes.tangent,
		geometry.attributes.uv,
		geometry.attributes.color,
	);
	material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
	material.textures.setTextures( renderer, 2048, 2048, textures );
	material.materials.updateFrom( materials, textures );

	ptRenderer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	const displayVideo = params.displayVideo && ! CanvasCapture.isRecording() && videoUrl !== '';
	videoEl.style.display = displayVideo ? '' : 'none';
	if ( displayVideo ) {

		return;

	}

	controls.enabled = ! CanvasCapture.isRecording();
	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.bounces = params.bounces;

	camera.updateMatrixWorld();

	for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

		if ( CanvasCapture.isRecording() && ptRenderer.samples >= params.samples ) {

			// record frame
			CanvasCapture.recordFrame();

			const angle = params.rotation / Math.ceil( params.frameRate * animationDuration );
			camera.position.applyAxisAngle( UP_AXIS, angle );
			controls.update();
			camera.updateMatrixWorld();

			recordedFrames ++;
			if ( recordedFrames >= params.frameRate * params.duration ) {

				// save the video
				CanvasCapture.stopRecord();
				recordedFrames = 0;

				rebuildGUI();

			}

			const delta = 1 / params.frameRate;
			model.mixer.update( delta );

			regenerateScene();

		}

		ptRenderer.update();

	}

	if ( ptRenderer.samples < 1 ) {

		renderer.render( scene, camera );

	}

	renderer.autoClear = false;
	fsQuad.render( renderer );
	renderer.autoClear = true;

	if ( CanvasCapture.isRecording() ) {

		const total = Math.ceil( params.frameRate * params.duration );
		const percStride = 1 / total;
		const samplesPerc = ptRenderer.samples / params.samples;
		const percentDone = ( samplesPerc + recordedFrames ) * percStride;
		samplesEl.innerText = `Frame Samples        : ${ Math.floor( ptRenderer.samples ) }\n`;
		samplesEl.innerText += `Frames Rendered      : ${ recordedFrames } / ${ total }\n`;
		samplesEl.innerText += `Rendering Completion : ${ ( percentDone * 100 ).toFixed( 2 ) }%`;

	} else {

		samplesEl.innerText = '';
		samplesEl.innerText += `Samples : ${ Math.floor( ptRenderer.samples ) }`;

	}

}
