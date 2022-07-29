import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera, PhysicalSpotLight, IESLoader } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

let renderer, controls, transformControlsScene, spotLight, lights, spotLights, spotLightHelper, sceneInfo, ptRenderer, fsQuad, materials;
let perspectiveCamera;
let scene;
let iesTextures;
let samplesEl;

// ies library profiles
const iesProfileURLs = [
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/0646706b3d2d9658994fc4ad80681dec.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/06b4cfdc8805709e767b5e2e904be8ad.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/007cfb11e343e2f42e3b476be4ab684e.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/01dac7d6c646814dcda6780e7b7b4566.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/108b32f07d6d38a7a6528a6d307440df.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/1aec5958092c236d005093ca27ebe378.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/02a7562c650498ebb301153dbbf59207.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/1a936937a49c63374e6d4fbed9252b29.ies',
	'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/00c6ce79e1d2cdf3a1fb491aaaa47ae0.ies',
];

// gui parameters
const params = {

	floorMaterial: {
		color: '#555555',
		roughness: 0.05,
		metalness: 0.4,
	},
	wallMaterial: {
		color: '#a06464',
		roughness: 0.4,
		metalness: 0.1,
	},

	multipleImportanceSampling: true,
	environmentIntensity: 0.1,
	bounces: 3,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 2,
	iesProfile: - 1,
	showTransformControls: false,
	showLightHelper: false,
};

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.resolutionScale *= 0.5;
	params.tiles = 2;

}

init();

async function init() {

	// init renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.setClearColor( 0, 0 );
	renderer.shadowMap.enabled = true;
	document.body.appendChild( renderer.domElement );

	// init camera
	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 2, 4, 8 ).multiplyScalar( 0.8 );
	perspectiveCamera.bokehSize = 0;

	// init path traer
	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.backgroundBlur = 0.2;
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.camera = perspectiveCamera;

	// init copy quad
	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: THREE.CustomBlending,
	} ) );

	// init controls
	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.target.y = 1.5;
	controls.update();
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	scene = new THREE.Scene();
	transformControlsScene = new THREE.Scene();

	samplesEl = document.getElementById( 'samples' );

	// load the env map
	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' ).then( texture => {

			scene.environment = texture;
			scene.background = texture;

			return texture;

		} );

	// load the geometry
	const generator = new PathTracingSceneWorker();
	const gltfPromise = new GLTFLoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/steampunk-robot/scene.gltf' )
		.then( gltf => {

			const group = new THREE.Group();

			// objects
			gltf.scene.scale.setScalar( 1 );
			gltf.scene.updateMatrixWorld();
			gltf.scene.traverse( c => {

				c.castShadow = true;
				c.receiveShadow = true;
				if ( c.material ) {

					c.material.roughness = 0.4;

				}

			} );
			group.add( gltf.scene );

			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			// init environment
			const floor = new THREE.Mesh(
				new THREE.CylinderBufferGeometry( 8, 8, 0.5, 200 ),
				new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.5, metalness: 0.2 } ),
			);
			floor.geometry = floor.geometry.toNonIndexed();
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.25;
			floor.receiveShadow = true;
			group.add( floor );

			const wall = new THREE.Mesh(
				new THREE.BoxGeometry( 14, 6, 0.5 ),
				new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0, metalness: 1.0 } ),
			);
			wall.castShadow = true;
			wall.receiveShadow = true;
			wall.geometry = wall.geometry.toNonIndexed();
			wall.geometry.clearGroups();
			wall.position.x = 0.0;
			wall.position.y = box.min.y + 3;
			wall.position.z = box.min.z - 0.5;
			group.add( wall );

			// transform controls
			function makeTransformControls( object ) {

				const transformControls = new TransformControls( perspectiveCamera, renderer.domElement );
				transformControls.addEventListener( 'objectChange', () => {

					ptRenderer.reset();

				} );

				transformControls.addEventListener( 'dragging-changed', ( e ) => {

					controls.enabled = ! e.value;

				} );

				transformControls.attach( object );
				transformControlsScene.add( transformControls );

			}

			// spot light
			lights = [];
			spotLights = [];

			spotLight = new PhysicalSpotLight( 0xffffff );
			spotLight.position.set( 0, 7.0, 4 );
			spotLight.angle = Math.PI / 4.5;
			spotLight.decay = 0;
			spotLight.penumbra = 1.0;
			spotLight.distance = 0.0;
			spotLight.intensity = 50.0;
			spotLight.radius = 0.5;

			spotLight.shadow.mapSize.width = 512;
			spotLight.shadow.mapSize.height = 512;
			spotLight.shadow.camera.near = 0.1;
			spotLight.shadow.camera.far = 10.0;
			spotLight.shadow.focus = 1.0;
			spotLight.castShadow = true;
			group.add( spotLight );

			spotLights.push( spotLight );
			lights.push( spotLight );

			const targetObject = spotLight.target;
			targetObject.position.x = 0;
			targetObject.position.y = floor.position.y + 2;
			targetObject.position.z = 0.05;
			targetObject.updateMatrixWorld();
			spotLight.updateMatrixWorld();
			group.add( targetObject );

			spotLightHelper = new THREE.SpotLightHelper( spotLight );
			transformControlsScene.add( spotLightHelper );

			makeTransformControls( spotLight );
			makeTransformControls( targetObject );

			// ies textures
			const iesPromises = iesProfileURLs.map( url => {

				return new IESLoader().loadAsync( url );

			} );

			materials = [ floor.material, wall.material ];

			return Promise.all( [ generator.generate( group ), Promise.all( iesPromises ) ] );

		} )
		.then( ( [ result, _iesTextures ] ) => {

			iesTextures = _iesTextures;
			sceneInfo = result;

			scene.add( result.scene );

			const { bvh, textures, materials, lights, spotLights } = result;
			const geometry = bvh.geometry;
			const material = ptRenderer.material;

			material.bvh.updateFrom( bvh );
			material.normalAttribute.updateFrom( geometry.attributes.normal );
			material.tangentAttribute.updateFrom( geometry.attributes.tangent );
			material.uvAttribute.updateFrom( geometry.attributes.uv );
			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
			material.textures.setTextures( renderer, 2048, 2048, textures );
			material.materials.updateFrom( materials, textures );
			material.iesProfiles.updateFrom( renderer, iesTextures );
			material.lights.updateFrom( lights );
			material.lightCount = lights.length;
			material.spotLights.updateFrom( spotLights, iesTextures );
			material.spotLightCount = spotLights.length;
			ptRenderer.material.envMapInfo.updateFrom( scene.environment );

			generator.dispose();

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );

	document.getElementById( 'loading' ).remove();

	// gui
	onResize();
	window.addEventListener( 'resize', onResize );
	const gui = new GUI();
	gui.add( params, 'showTransformControls' );
	gui.add( params, 'showLightHelper' );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( value => {

		ptRenderer.material.setDefine( 'FEATURE_MIS', Number( value ) );
		ptRenderer.reset();

	} );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		ptRenderer.reset();

	} );

	const matFolder1 = gui.addFolder( 'Floor Material' );
	matFolder1.addColor( params.floorMaterial, 'color' ).onChange( reset );
	matFolder1.add( params.floorMaterial, 'roughness', 0, 1 ).onChange( reset );
	matFolder1.add( params.floorMaterial, 'metalness', 0, 1 ).onChange( reset );
	matFolder1.close();

	const matFolder2 = gui.addFolder( 'Wall Material' );
	matFolder2.addColor( params.wallMaterial, 'color' ).onChange( reset );
	matFolder2.add( params.wallMaterial, 'roughness', 0, 1 ).onChange( reset );
	matFolder2.add( params.wallMaterial, 'metalness', 0, 1 ).onChange( reset );
	matFolder2.close();

	const lightFolder = gui.addFolder( 'Spot Light' );
	lightFolder.addColor( spotLight, 'color' ).onChange( reset );
	lightFolder.add( spotLight, 'intensity', 0.0, 200.0, 0.01 ).onChange( reset );
	lightFolder.add( spotLight, 'radius', 0.0, 10.0 ).onChange( reset );
	lightFolder.add( spotLight, 'decay', 0.0, 2.0 ).onChange( reset );
	lightFolder.add( spotLight, 'distance', 0.0, 20.0 ).onChange( reset );
	lightFolder.add( spotLight, 'angle', 0.0, Math.PI / 2.0 ).onChange( reset );
	lightFolder.add( spotLight, 'penumbra', 0.0, 1.0 ).onChange( reset );
	lightFolder.add( params, 'iesProfile', - 1, iesProfileURLs.length - 1, 1 ).onChange( v => {

		spotLight.iesTexture = v === - 1 ? null : iesTextures[ v ];
		reset();

	} );

	animate();

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

	const aspect = w / h;

	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

}

function reset() {

	ptRenderer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	// update materials
	const m0 = materials[ 0 ];
	m0.color.set( params.floorMaterial.color ).convertSRGBToLinear();
	m0.metalness = params.floorMaterial.metalness;
	m0.roughness = params.floorMaterial.roughness;

	const m1 = materials[ 1 ];
	m1.color.set( params.wallMaterial.color ).convertSRGBToLinear();
	m1.metalness = params.wallMaterial.metalness;
	m1.roughness = params.wallMaterial.roughness;

	// update path tracer
	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );

	ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
	ptRenderer.material.environmentIntensity = params.environmentIntensity;
	ptRenderer.material.bounces = params.bounces;
	ptRenderer.material.physicalCamera.updateFrom( perspectiveCamera );

	ptRenderer.material.lights.updateFrom( lights );
	ptRenderer.material.spotLights.updateFrom( spotLights, iesTextures );

	// update objects
	perspectiveCamera.updateMatrixWorld();
	spotLightHelper.update();

	// render
	for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

		ptRenderer.update();

	}

	if ( ptRenderer.samples < 1 ) {

		renderer.render( scene, perspectiveCamera );

	}

	renderer.autoClear = false;

	fsQuad.material.map = ptRenderer.target.texture;
	fsQuad.material.depthWrite = false;
	fsQuad.render( renderer );

	transformControlsScene.children.forEach( c => {

		c.visible = c instanceof THREE.SpotLightHelper ? params.showLightHelper : params.showTransformControls;
		if ( 'enabled' in c ) c.enabled = params.showTransformControls;

	} );

	renderer.render( transformControlsScene, perspectiveCamera );

	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}
