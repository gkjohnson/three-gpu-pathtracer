import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera, PhysicalSpotLight, FogVolumeMaterial } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

let renderer, controls, sceneInfo, ptRenderer, blitQuad;
let perspectiveCamera, scene, fogMaterial, spotLight;
let samplesEl;

const params = {

	enable: true,
	pause: false,
	mis: true,
	tiles: 2,
	resolutionScale: 1 / window.devicePixelRatio,

	color: '#eeeeee',
	fog: true,
	density: 0.01,
	lightIntensity: 500,
	lightColor: '#ffffff',

	bounces: 10,

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
	perspectiveCamera.position.set( 0, 1, 6 );

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
	fogMaterial = new FogVolumeMaterial();

	const generator = new PathTracingSceneWorker();
	const envMat = new MeshStandardMaterial( { color: 0x999999, roughness: 1, metalness: 0 } );
	const fogMesh = new Mesh( new BoxGeometry( 8, 4.05, 8 ), fogMaterial );
	const floor = new Mesh( new CylinderGeometry( 5, 5, 0.1, 40 ), envMat );
	floor.position.y = - 1.1;

	spotLight = new PhysicalSpotLight();
	spotLight.position.set( 0, 1, 0 ).multiplyScalar( 3 );
	spotLight.angle = Math.PI / 4.5;
	spotLight.decay = 2;
	spotLight.penumbra = 0.15;
	spotLight.distance = 0.0;
	spotLight.intensity = 50.0;
	spotLight.radius = 0.05;

	const lightGroup = new Group();
	lightGroup.add( spotLight );

	const TOTAL_SLATS = 10;
	const WIDTH = 2.0;
	const slat = new Mesh( new BoxGeometry( 0.1, 0.1, 2 ), envMat );
	for ( let i = 0; i < TOTAL_SLATS; i ++ ) {

		const s = slat.clone();
		s.position.x = - WIDTH * 0.5 + WIDTH * i / ( TOTAL_SLATS - 1 );
		s.position.y = 2;
		lightGroup.add( s );

	}

	const group = new Group();
	group.add( fogMesh, floor, lightGroup );

	group.updateMatrixWorld();
	sceneInfo = await generator.generate( group );
	scene.add( sceneInfo.scene );

	const { bvh, textures, materials } = sceneInfo;
	const geometry = bvh.geometry;
	ptRenderer.material.environmentIntensity = 0.0;
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
	ptRenderer.material.lights.updateFrom( sceneInfo.lights );

	generator.dispose();

	onResize();

	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'enable' );
	ptFolder.add( params, 'pause' );
	ptFolder.add( params, 'bounces', 1, 20, 1 ).onChange( () => ptRenderer.reset() );
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

	const fogFolder = gui.addFolder( 'fog' );
	fogFolder.addColor( params, 'color' ).onChange( reset );
	fogFolder.add( params, 'density', 0, 1 ).onChange( reset );

	const lightFolder = gui.addFolder( 'light' );
	lightFolder.add( params, 'lightIntensity', 0, 1000 ).onChange( reset );
	lightFolder.addColor( params, 'lightColor' ).onChange( reset );

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

	fogMaterial.color.set( params.color ).convertSRGBToLinear();
	fogMaterial.density = params.density;

	spotLight.intensity = params.lightIntensity;
	spotLight.color.set( params.lightColor );

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.lights.updateFrom( sceneInfo.lights );
	perspectiveCamera.updateMatrixWorld();

	ptRenderer.material.bounces = params.bounces;

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




