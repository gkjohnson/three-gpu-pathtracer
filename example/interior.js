import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad;
let samplesEl;
const params = {

	environmentIntensity: 0,
	environmentRotation: 0,
	emissiveIntensity: 100,
	bounces: 20,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
	tiles: 2,


};

if ( window.location.hash.includes( 'transmission' ) ) {

	params.material1.metalness = 0.0;
	params.material1.roughness = 0.05;
	params.material1.transmission = 1.0;
	params.material1.color = '#ffffff';
	params.bounces = 10;

}

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

	samplesEl = document.getElementById( 'samples' );

	const envMapPromise = new Promise( resolve => {

		new RGBELoader()
			.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

				const pmremGenerator = new THREE.PMREMGenerator( renderer );
				pmremGenerator.compileCubemapShader();

				const envMap = pmremGenerator.fromEquirectangular( texture );

				ptRenderer.material.environmentMap = envMap.texture;
				resolve();

			} );

	} );

	const generator = new PathTracingSceneGenerator();
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/pathtracing-bathroom/modernbathroom.glb' )
		.then( gltf => {

			const group = new THREE.Group();
			group.add( gltf.scene );

			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			group.updateMatrixWorld();

			const center = new THREE.Vector3();
			box.getCenter( center );

			gltf.scene.position.addScaledVector( center, - 0.5 );
			group.updateMatrixWorld();

			return generator.generate( group );

		} )
		.then( result => {

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

			generator.dispose();

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );

	window.CAMERA = camera;
	window.CONTROLS = controls;

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
	gui.add( params, 'emissiveIntensity', 0, 300 ).onChange( updateIntensity );
	gui.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	updateIntensity();

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

function updateIntensity() {

	sceneInfo.materials.forEach( material => {

		material.emissiveIntensity = params.emissiveIntensity;

	} );
	ptRenderer.reset();

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
	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}




