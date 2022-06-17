import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Scene } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let renderer, controls, transformControls, transformControlsScene, areaLights, sceneInfo, ptRenderer, camera, fsQuad;
let samplesEl, loadingEl;
const params = {

	environmentIntensity: 0.2,
	environmentRotation: 0,
	areaLightIntensity: 20.0,
	bounces: 3,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
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

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0.4, 0.6, 2.65 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 0.33, - 0.08 );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );
	controls.update();

	camera.lookAt( - 0.15, 0.33, - 0.08 );

	samplesEl = document.getElementById( 'samples' );
	loadingEl = document.getElementById( 'loading' );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' )
		.then( texture => {

			ptRenderer.material.envMapInfo.updateFrom( texture );

		} );

	const group = new THREE.Group();

	const box = new THREE.Box3();
	const { scene } = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/threedscans/Hosmer.glb' );

	scene.scale.setScalar( 0.002 );
	scene.rotation.x = - Math.PI / 2;
	scene.updateMatrixWorld( true );

	box.setFromObject( scene );
	scene.position.y -= box.min.y;

	group.add( scene );

	const floorGeom = new THREE.PlaneBufferGeometry( 10, 10 );
	const floorMat = new THREE.MeshPhysicalMaterial( { color: new THREE.Color( 0x999999 ), roughness: 0.1 } );
	const floor = new THREE.Mesh( floorGeom, floorMat );
	floor.rotateX( Math.PI / 2 );
	group.add( floor );

	const redBoxGeom = new THREE.BoxBufferGeometry( 0.5, 2, 2 );
	const redBoxMat = new THREE.MeshPhysicalMaterial( { color: new THREE.Color( 0xAA0000 ) } );
	const redBox = new THREE.Mesh( redBoxGeom, redBoxMat );
	redBox.position.set( - 1.5, 1.0, 0.0 );
	group.add( redBox );

	group.updateMatrixWorld();

	const areaLight1 = new THREE.RectAreaLight( new THREE.Color( 0xFFFFFF ), 20.0, 1.0, 1.0 );
	areaLight1.position.x = 1.5;
	areaLight1.position.y = 1.0;
	areaLight1.position.z = - 0.5;
	areaLight1.rotateZ( - Math.PI / 4 );
	areaLight1.rotateX( - Math.PI / 2 );
	group.add( areaLight1 );

	const areaLight2 = new THREE.RectAreaLight( new THREE.Color( 0x00FF00 ), 10.0, 5.0, 1.0 );
	areaLight2.position.x = - 2.5;
	areaLight2.position.y = 0.5;
	areaLight2.position.z = - 3.0;
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

	transformControlsScene = new Scene();
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
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'environmentIntensity', 0, 25 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'environmentRotation', 0, 40 ).onChange( v => {

		ptRenderer.material.environmentRotation.setFromMatrix4( new THREE.Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	gui.add( params, 'areaLightIntensity', 0, 50 ).onChange( updateIntensity );
	gui.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );
	gui.add( params, 'multipleImportanceSampling' ).onChange( () => {

		ptRenderer.material.defines.FEATURE_MIS = params.multipleImportanceSampling ? 1 : 0;
		ptRenderer.material.needsUpdate = true;
		ptRenderer.reset();

	} );

	updateIntensity();

	animate();

}

function updateIntensity() {

	areaLights[ 0 ].intensity = params.areaLightIntensity;
	ptRenderer.material.lights.updateFrom( areaLights );
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




