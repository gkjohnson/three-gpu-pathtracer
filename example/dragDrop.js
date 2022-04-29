import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough } from '@gltf-transform/functions';
import { DocumentView, ImageProvider } from '@gltf-transform/view';
import { getFilesFromDataTransferItems } from "@placemarkio/flat-drop-files";

let renderer, controls, scene, sceneInfo, ptRenderer, camera, fsQuad;

let frameRequestID;

const loadingEl = document.getElementById( 'loading' );
const creditEl = document.getElementById( 'credits' );
const samplesEl = document.getElementById( 'samples' );

const params = {

	environmentIntensity: 3.0,
	environmentRotation: 0,
	emissiveIntensity: 1,
	bounces: 20,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
	tiles: 2,

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.min( params.bounces, 10 );
	params.resolutionScale *= 0.5;
	params.tiles = 3;

}

const io = new WebIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({'meshopt.decoder': MeshoptDecoder});

const imageProvider = new ImageProvider();

const generator = new PathTracingSceneWorker();

//

init();

//

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.1, 10 );
	camera.position.set( 0, 0, 2 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 0, 0 );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => ptRenderer.reset() );
	controls.update();

	//

	const environmentTexture = await new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr');

	const pmremGenerator = new THREE.PMREMGenerator( renderer );
	pmremGenerator.compileCubemapShader();

	const envMap = pmremGenerator.fromEquirectangular( environmentTexture );

	ptRenderer.material.environmentMap = envMap.texture;
	scene.environment = envMap.texture;

	//

	window.CAMERA = camera;
	window.CONTROLS = controls;

	onResize();
	window.addEventListener( 'resize', onResize );

	initGUI();

}

function initGUI() {

	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => ptRenderer.tiles.set( value, value ) );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => ptRenderer.reset() );
	gui.add( params, 'environmentIntensity', 0, 25 ).onChange( () => ptRenderer.reset() );
	gui.add( params, 'environmentRotation', 0, 40 ).onChange( v => {

		ptRenderer.material.environmentRotation.setFromMatrix4( new THREE.Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	gui.add( params, 'bounces', 1, 30, 1 ).onChange( () => ptRenderer.reset() );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => onResize() );

}

async function updateModel( modelDocument ) {

	scene.clear();
	imageProvider.clear();
	ptRenderer.reset();

	const modelRootDef = modelDocument.getRoot();
	const modelSceneDef = modelRootDef.getDefaultScene() || modelRootDef.listScenes()[0];
	const extensionsUsed = modelDocument.getRoot().listExtensionsUsed();

	// prepare model

	if ( extensionsUsed.some( ( ext ) => ext.extensionName === 'KHR_materials_pbrSpecularGlossiness' ) ) {

		await modelDocument.transform( metalRough() );

	}

	// create three.js view of glTF document

	await imageProvider.update( modelRootDef.listTextures() );
	const modelView = new DocumentView( modelDocument )
		.setImageProvider( imageProvider );
	const model = modelView.view( modelSceneDef );

	// center the model

	model.updateMatrixWorld();

	const box = new THREE.Box3();
	box.setFromObject( model );
	model.position
		.addScaledVector( box.min, - 0.5 )
		.addScaledVector( box.max, - 0.5 );

	const sphere = new THREE.Sphere();
	box.getBoundingSphere( sphere );

	model.scale.setScalar( 1 / sphere.radius );
	model.position.multiplyScalar( 1 / sphere.radius );

	model.updateMatrixWorld();

	scene.add( model );

	// load the model

	const result = await generator.generate( scene );

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
	material.setDefine( 'MATERIAL_LENGTH', materials.length );

	loadingEl.style.visibility = 'hidden';

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const scale = params.resolutionScale;
	const dpr = window.devicePixelRatio;

	ptRenderer.target.setSize( w * scale * dpr, h * scale * dpr );
	ptRenderer.reset();

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio * scale );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function animate() {

	frameRequestID = requestAnimationFrame( animate );

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
	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}

// drag-and-drop implementation

document.body.addEventListener( 'dragenter', ( e ) => {

	e.preventDefault();

});

document.body.addEventListener( 'dragover', ( e ) => {

	e.preventDefault();

});

document.body.addEventListener('drop', ( e ) => {

	e.preventDefault();

	cancelAnimationFrame( frameRequestID );

	samplesEl.innerText = '--';
	creditEl.innerText = '--';
	loadingEl.innerText = 'Parsing';
	loadingEl.style.visibility = 'visible';

	getFilesFromDataTransferItems( e.dataTransfer.items ).then( async ( files ) => {

		for ( const file of files ) {

			if ( file.name.endsWith( '.glb' ) ) {

				const arrayBuffer = await file.arrayBuffer();
				const modelJSONDocument = await io.binaryToJSON( new Uint8Array( arrayBuffer ) );
				const modelDocument = await io.readJSON( modelJSONDocument );

				creditEl.innerText = JSON.stringify( modelJSONDocument.json.asset, null, 2 );

				updateModel( modelDocument );
				return;

			}

		}

	});

});
