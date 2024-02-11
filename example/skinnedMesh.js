import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DynamicPathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial, BlurredEnvMapGenerator } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad, scene, clock, model;
let samplesEl;
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
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5.5, 3.5, 7.5 );

	// initialize path tracer
	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.filterGlossyFactor = 0.25;
	ptRenderer.material.setDefine( 'FEATURE_MIS', 0 );
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		transparent: true,
	} ) );

	// initialize controls
	controls = new OrbitControls( camera, renderer.domElement );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );
	controls.update();

	samplesEl = document.getElementById( 'samples' );

	clock = new THREE.Clock();

	// loading the
	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' )
		.then( texture => {

			const generator = new BlurredEnvMapGenerator( renderer );
			const blurredTex = generator.generate( texture, 0.35 );
			ptRenderer.material.envMapInfo.updateFrom( blurredTex );
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

	modelPromise = modelPromise.then( res => model = res );

	await Promise.all( [ envMapPromise, modelPromise ] );
	scene.add( model.scene );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	// init gui
	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'bounces', 1, 10, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

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

	model.action.paused = v;
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

			const action = mixer.clipAction( animations[ 0 ] );
			action.play();
			action.paused = params.pause;

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

	const w = window.innerWidth;
	const h = window.innerHeight;
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

	const { sceneGenerator } = model;
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

	// step the animation forward
	const delta = Math.min( clock.getDelta(), 30 * 0.001 );
	model.mixer.update( delta );
	model.scene.updateMatrixWorld();
	model.scene.traverse( c => {

		// TODO: why is this needed?
		if ( c.skeleton ) {

			c.skeleton.update();

		}

	} );

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

		ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
		ptRenderer.material.environmentIntensity = params.environmentIntensity;
		ptRenderer.material.bounces = params.bounces;

		camera.updateMatrixWorld();

		// update samples
		for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

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

}
