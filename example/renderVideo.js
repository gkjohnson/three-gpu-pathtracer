import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DynamicPathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad, scene, gui, model;
let samplesEl;
let recording = false;
let recordedFrames = 0;
let animationDuration = 0;
const params = {

	tiles: 1,
	rotate: true,
	duration: 0,
	frameRate: 12,
	samples: 100,
	record: () => {

		ptRenderer.reset();
		recording = true;
		recordedFrames = 0;
		rebuildGUI();

	},
	stop: () => {

		// save video

		recording = false;
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

	renderer = new THREE.WebGLRenderer( { antialias: true } );
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

	clock = new THREE.Clock();

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

		} );

	await Promise.all( [ envMapPromise, modelPromise ] );
	scene.add( model.scene );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	rebuildGUI();

	animate();

}

function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	params.duration = animationDuration;

	gui = new GUI();
	const animationFolder = gui.addFolder( 'animation' );

	animationFolder.add( params, 'rotate' ).disable( recording );
	animationFolder.add( params, 'duration', 0.25, animationDuration, 1e-2 ).disable( recording );
	animationFolder.add( params, 'frameRate', 12, 60, 1 ).disable( recording );
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
	renderFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

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
			console.log( mixer );

			const clip = animations[ 0 ];
			const action = mixer.clipAction( clip );
			action.play();
			animationDuration = parseFloat( clip.duration.toFixed( 2 ) );

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

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio * scale );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function regenerateScene() {

	const { scene, sceneGenerator } = model;
	const result = sceneGenerator.generate( scene );
	sceneInfo = result;

	const { bvh, textures, materials } = result;
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

	if ( ptRenderer.samples < 1 ) {

		renderer.render( scene, camera );

	}

	if ( ! sceneInfo ) {

		regenerateScene();

	}

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.bounces = params.bounces;

	camera.updateMatrixWorld();

	for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

		if ( recording && ptRenderer.samples >= params.samples ) {

			// record frame

			recordedFrames ++;
			if ( recordedFrames >= params.frames ) {

				// save the video
				recording = false;
				recordedFrames = 0;

			}

			const delta = 1 / params.frameRate;
			model.mixer.update( delta );
			model.scene.updateMatrixWorld();

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

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;


}
