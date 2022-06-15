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
	bounces: 3,
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
	ptRenderer.material.setDefine( 'FEATURE_MIS', 0 );
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

	const envMapPromise = new Promise( resolve => {

		new RGBELoader()
			.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

				const generator = new BlurredEnvMapGenerator( renderer );
				const blurredTex = generator.generate( texture, 0.35 );
				ptRenderer.material.envMapInfo.updateFrom( blurredTex );
				generator.dispose();

				scene.background = blurredTex;
				scene.environment = blurredTex;

				resolve();

			} );

	} );

	if ( window.location.hash === '#morphtarget' ) {

		model = await loadModel( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb' );

	} else {

		model = await loadModel( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf' );

	}

	// model = await loadModel( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/pigman/scene.gltf' );
	scene.add( model.scene );

	await envMapPromise;

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'bounces', 1, 5, 1 ).onChange( () => {

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
				new THREE.PlaneBufferGeometry(),
				new THREE.MeshStandardMaterial( {
					map: floorTex,
					transparent: true,
					color: 0xdddddd,
					roughness: 0.025,
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

	const { scene, sceneGenerator } = model;
	const result = sceneGenerator.generate( scene );
	sceneInfo = result;

	const { bvh, textures, materials } = result;
	const geometry = bvh.geometry;
	const material = ptRenderer.material;

	material.bvh.updateFrom( bvh );
	material.normalAttribute.updateFrom( geometry.attributes.normal );
	material.tangentAttribute.updateFrom( geometry.attributes.tangent );
	material.uvAttribute.updateFrom( geometry.attributes.uv );
	material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
	material.textures.setTextures( renderer, 2048, 2048, textures );
	material.materials.updateFrom( materials, textures );

	ptRenderer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	const delta = Math.min( clock.getDelta(), 30 * 0.001 );
	model.mixer.update( delta );
	model.scene.updateMatrixWorld();

	if ( params.autoPause ) {

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

		if ( ! params.pause && params.continuous ) {

			regenerateScene();

		}

		ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
		ptRenderer.material.environmentIntensity = params.environmentIntensity;
		ptRenderer.material.environmentBlur = 0.35;
		ptRenderer.material.bounces = params.bounces;

		camera.updateMatrixWorld();

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
