import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let renderer, controls, transformControls, transformControlsScene, areaLights, sceneInfo, ptRenderer, camera, fsQuad;
let samplesEl, loadingEl;
const params = {

	controls: true,

	areaLight1Enabled: true,
	areaLight2Enabled: true,
	areaLight1Intensity: 5,
	areaLight1Color: '#ffffff',
	areaLight1Width: 1,
	areaLight1Height: 1,

	areaLight2Intensity: 20,
	areaLight2Color: '#ff0000',
	areaLight2Width: 1.25,
	areaLight2Height: 2.75,

	environmentIntensity: 0.1,
	environmentRotation: 0,

	bounces: 3,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	multipleImportanceSampling: true

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.min( params.bounces, 10 );
	params.resolutionScale *= 0.5;
	params.tiles = 3;

}

init();

// other sculptures
// * https://sketchfab.com/3d-models/nile-42e02439c61049d681c897441d40aaa1
// * https://sketchfab.com/3d-models/statue-of-bacchus-09f1c94f43e0400c8916149bab297918
// https://sketchfab.com/3d-models/2-aliens-figure-a58af7bd939d46fca4eb46e43588944f
// * https://sketchfab.com/3d-models/lowe-4afeca000f444619ad581a30aa4fd17e
// * https://sketchfab.com/3d-models/laocoon-and-his-sons-649111a9a7b74ddab3937292be5545fc
// * https://sketchfab.com/3d-models/mercury-about-to-kill-argos-by-b-thorvaldsen-bdcd0813bf54467fb879ee1681a3a6d3

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0.0, 0.6, 2.65 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 0.33, - 0.08 );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );
	controls.update();

	camera.lookAt( - 0.15, 0.33, - 0.08 );

	samplesEl = document.getElementById( 'samples' );
	loadingEl = document.getElementById( 'loading' );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr' )
		.then( texture => {

			ptRenderer.material.envMapInfo.updateFrom( texture );

		} );

	const group = new THREE.Group();

	const box = new THREE.Box3();
	const { scene } = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mercury-about-to-kill-argos/scene.glb' );

	scene.traverse( c => {

		if ( c.material ) c.material.map = null;

	} );

	scene.scale.setScalar( 0.01 );
	// scene.rotation.x = - Math.PI / 2;
	scene.position.x = 0.05;
	scene.updateMatrixWorld( true );

	box.setFromObject( scene );
	scene.position.y -= box.min.y;

	group.add( scene );

	const floorGeom = new THREE.CylinderBufferGeometry( 3.5, 3.5, 0.05, 60 );
	const floorMat = new THREE.MeshPhysicalMaterial( { color: new THREE.Color( 0x999999 ), metalness: 0.2, roughness: 0.02 } );
	const floor = new THREE.Mesh( floorGeom, floorMat );
	floor.position.y = - 0.025;
	group.add( floor );

	// const redBoxGeom = new THREE.BoxBufferGeometry( 0.1, 2, 2 );
	// const redBoxMat = new THREE.MeshPhysicalMaterial( { color: new THREE.Color( 0xFF0000 ) } );
	// const redBox = new THREE.Mesh( redBoxGeom, redBoxMat );
	// redBox.position.set( - 1.5, 1.0, 0.0 );
	// // group.add( redBox );

	group.updateMatrixWorld();

	const areaLight1 = new THREE.RectAreaLight( new THREE.Color( 0xFFFFFF ), 5.0, 1.0, 1.0 );
	areaLight1.position.x = 1.5;
	areaLight1.position.y = 1.0;
	areaLight1.position.z = - 0.5;
	areaLight1.rotateZ( - Math.PI / 4 );
	areaLight1.rotateX( - Math.PI / 2 );
	group.add( areaLight1 );

	const areaLight2 = new THREE.RectAreaLight( new THREE.Color( 0xff0000 ), 15.0, 1.25, 2.75 );
	areaLight2.position.y = 1.25;
	areaLight2.position.z = - 1.5;
	areaLight2.rotateX( Math.PI );
	group.add( areaLight2 );

	areaLights = [ areaLight1, areaLight2 ];

	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.addEventListener( 'objectChange', () => {

		ptRenderer.material.lights.updateFrom( areaLights );
		ptRenderer.reset();

	} );
	transformControls.addEventListener( 'dragging-changed', ( e ) => controls.enabled = ! e.value );
	transformControls.attach( areaLight1 );
	transformControls.setSize( 0.5 );

	window.addEventListener( 'keydown', function ( event ) {

		switch ( event.key ) {

		case 'w':
			transformControls.setMode( 'translate' );
			break;

		case 'e':
			transformControls.setMode( 'rotate' );
			break;

		}

	} );

	transformControlsScene = new THREE.Scene();
	transformControlsScene.add( transformControls );

	const generator = new PathTracingSceneWorker();
	const generatorPromise = generator.generate( group, {
		onProgress( v ) {

			loadingEl.innerText = `Generating BVH ${ ( 100 * v ).toFixed( 2 ) }%`;

		}
	} ).then( result => {

		sceneInfo = result;

		const { bvh, textures, materials, lights } = result;
		const geometry = bvh.geometry;
		const material = ptRenderer.material;

		material.bvh.updateFrom( bvh );
		material.normalAttribute.updateFrom( geometry.attributes.normal );
		material.tangentAttribute.updateFrom( geometry.attributes.tangent );
		material.uvAttribute.updateFrom( geometry.attributes.uv );
		material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
		material.textures.setTextures( renderer, 2048, 2048, textures );
		material.materials.updateFrom( materials, textures );
		material.lights.updateFrom( lights );
		material.lightCount = lights.length;

		generator.dispose();

	} );

	await Promise.all( [ generatorPromise, envMapPromise ] );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'controls' ).onChange( v => {

		transformControls.enabled = v;
		transformControls.visible = v;

	} );
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'bounces', 1, 15, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( () => {

		ptRenderer.material.defines.FEATURE_MIS = params.multipleImportanceSampling ? 1 : 0;
		ptRenderer.material.needsUpdate = true;
		ptRenderer.reset();

	} );
	ptFolder.close();

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 3 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( v => {

		ptRenderer.material.environmentRotation.setFromMatrix4( new THREE.Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	envFolder.close();

	const areaLight1Folder = gui.addFolder( 'Area Light 1' );
	areaLight1Folder.add( params, 'areaLight1Enabled' ).name( 'enable' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Intensity', 0, 200 ).name( 'intensity' ).onChange( updateLights );
	areaLight1Folder.addColor( params, 'areaLight1Color' ).name( 'color' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Width', 0, 5 ).name( 'width' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Height', 0, 5 ).name( 'height' ).onChange( updateLights );

	const areaLight2Folder = gui.addFolder( 'Area Light 2' );
	areaLight2Folder.add( params, 'areaLight2Enabled' ).name( 'enable' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2Intensity', 0, 200 ).name( 'intensity' ).onChange( updateLights );
	areaLight2Folder.addColor( params, 'areaLight2Color' ).name( 'color' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2Width', 0, 5 ).name( 'width' ).onChange( updateLights );
	areaLight2Folder.add( params, 'areaLight2Height', 0, 5 ).name( 'height' ).onChange( updateLights );

	updateLights();

	animate();

}

function updateLights() {

	areaLights[ 0 ].intensity = params.areaLight1Intensity;
	areaLights[ 0 ].width = params.areaLight1Width;
	areaLights[ 0 ].height = params.areaLight1Height;
	areaLights[ 0 ].color.set( params.areaLight1Color ).convertSRGBToLinear();

	areaLights[ 1 ].intensity = params.areaLight2Intensity;
	areaLights[ 1 ].width = params.areaLight2Width;
	areaLights[ 1 ].height = params.areaLight2Height;
	areaLights[ 1 ].color.set( params.areaLight2Color ).convertSRGBToLinear();

	const enabledLights = [];
	if ( params.areaLight1Enabled ) enabledLights.push( areaLights[ 0 ] );
	if ( params.areaLight2Enabled ) enabledLights.push( areaLights[ 1 ] );

	ptRenderer.material.lights.updateFrom( enabledLights );
	ptRenderer.reset();

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

function animate() {

	requestAnimationFrame( animate );

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );

	ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
	ptRenderer.material.environmentIntensity = params.environmentIntensity;
	ptRenderer.material.environmentBlur = 0.35;
	ptRenderer.material.bounces = params.bounces;

	camera.updateMatrixWorld();

	for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

		ptRenderer.update();

	}

	renderer.autoClear = false;
	fsQuad.render( renderer );
	renderer.render( transformControlsScene, camera );
	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}




