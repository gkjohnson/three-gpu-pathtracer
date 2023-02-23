import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { EquirectangularReflectionMapping, Mesh, MeshPhysicalMaterial, SphereGeometry } from 'three';

let renderer, controls, sceneInfo, ptRenderer, blitQuad;
let perspectiveCamera, scene, meshMaterial;
let samplesEl;

const params = {

	enable: true,
	pause: false,
	mis: true,
	tiles: 2,
	resolutionScale: 1,

	color: '#ffcccc',
	roughness: 0,
	metalness: 0,
	specularIntensity: 1,
	specularColor: '#ffffff',
	iridescence: 0.0,
	iridescenceIOR: 2,
	iridescenceThicknessMin: 0,
	iridescenceThicknessMax: 400,

	transmission: 1.0,
	ior: 1.5,

};

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.setClearColor( 0, 0 );
	document.body.appendChild( renderer.domElement );

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 4, 2, 3 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.camera = perspectiveCamera;

	blitQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: THREE.CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	scene = new THREE.Scene();

	samplesEl = document.getElementById( 'samples' );

	const BASE_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config/';
	const envUrl = new URL( '../../../shared-assets/environments/lightroom_14b.hdr', BASE_URL ).toString();

	await new RGBELoader()
		.loadAsync( envUrl )
		.then( texture => {

			texture.mapping = EquirectangularReflectionMapping;

			scene.background = texture;
			scene.environment = texture;

			ptRenderer.material.envMapInfo.updateFrom( texture );

		} );

	meshMaterial = new MeshPhysicalMaterial();
	const generator = new PathTracingSceneWorker();
	const mesh = new Mesh( new SphereGeometry( 1, 50, 50 ), meshMaterial );

	sceneInfo = await generator.generate( mesh );
	scene.add( sceneInfo.scene );

	const { bvh, textures, materials } = sceneInfo;
	const geometry = bvh.geometry;
	ptRenderer.material.bvh.updateFrom( bvh );
	ptRenderer.material.attributesArray.updateFrom(
		geometry.attributes.normal,
		geometry.attributes.tangent,
		geometry.attributes.uv,
		geometry.attributes.color,
	);
	ptRenderer.material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
	ptRenderer.material.textures.setTextures( renderer, 2048, 2048, textures );
	ptRenderer.material.materials.updateFrom( materials, textures );

	generator.dispose();

	document.getElementById( 'loading' ).remove();

	onResize();

	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'enable' );
	ptFolder.add( params, 'pause' );
	ptFolder.add( params, 'mis' ).onChange( v => {

		ptRenderer.material.setDefine( 'FEATURE_MIS', Number( v ) );
		ptRenderer.reset();

	} );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const matFolder = gui.addFolder( 'Material' );
	matFolder.addColor( params, 'color' ).onChange( reset );
	matFolder.add( params, 'roughness', 0, 1 ).onChange( reset );
	matFolder.add( params, 'metalness', 0, 1 ).onChange( reset );
	matFolder.add( params, 'specularIntensity', 0, 1 ).onChange( reset );
	matFolder.addColor( params, 'specularColor' ).onChange( reset );
	matFolder.add( params, 'transmission', 0, 1 ).onChange( reset );
	matFolder.add( params, 'ior', 1, 2 ).onChange( reset );

	matFolder.add( params, 'iridescence', 0, 1 ).onChange( reset );
	matFolder.add( params, 'iridescenceIOR', 1, 2 ).onChange( reset );
	matFolder.add( params, 'iridescenceThicknessMin', 0, 1000, 1 ).onChange( reset );
	matFolder.add( params, 'iridescenceThicknessMax', 0, 1000, 1 ).onChange( reset );

	animate();

}

function reset() {

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

	const aspect = w / h;
	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	ptRenderer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	meshMaterial.color.set( params.color ).convertSRGBToLinear();
	meshMaterial.roughness = params.roughness;
	meshMaterial.metalness = params.metalness;

	meshMaterial.thickness = 1.0;
	meshMaterial.ior = params.ior;
	meshMaterial.transmission = params.transmission;
	meshMaterial.iridescence = params.iridescence;
	meshMaterial.iridescenceIOR = params.iridescenceIOR;
	meshMaterial.iridescenceThicknessRange = [ params.iridescenceThicknessMin, params.iridescenceThicknessMax ];
	meshMaterial.specularIntensity = params.specularIntensity;
	meshMaterial.specularColor.set( params.specularColor ).convertSRGBToLinear();

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	perspectiveCamera.updateMatrixWorld();

	if ( ptRenderer.samples < 1 || ! params.enable ) {

		renderer.render( scene, perspectiveCamera );

	}

	if ( params.enable ) {

		if ( ! params.pause || ptRenderer.samples < 1 ) {

			ptRenderer.update();

		}

		renderer.autoClear = false;
		blitQuad.material.map = ptRenderer.target.texture;
		blitQuad.render( renderer );
		renderer.autoClear = true;

	}

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}




