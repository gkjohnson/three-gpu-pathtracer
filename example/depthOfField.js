import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera, BlurredEnvMapGenerator } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad, scene;
let samplesEl;
const mouse = new THREE.Vector2();
const focusPoint = new THREE.Vector3();
const params = {

	environmentIntensity: 1,
	environmentRotation: 0,
	bounces: 3,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	autoFocus: true,

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.max( params.bounces, 6 );
	params.resolutionScale *= 0.5;
	params.tiles = 2;

}

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	camera = new PhysicalCamera( 60, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( - 0.262, 0.5276, - 1.1606 );
	camera.apertureBlades = 6;
	camera.fStop = 0.6;
	camera.focusDistance = 1.1878;
	focusPoint.set( - 0.5253353217832674, 0.3031596413506029, 0.000777794185259223 );

	scene = new THREE.Scene();

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.material.setDefine( 'FEATURE_GRADIENT_BG', 1 );
	ptRenderer.material.setDefine( 'FEATURE_MIS', 0 );
	ptRenderer.material.bgGradientTop.set( 0x390f20 ).convertSRGBToLinear();
	ptRenderer.material.bgGradientBottom.set( 0x151b1f ).convertSRGBToLinear();

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: THREE.CustomBlending,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.182, 0.147, 0.06 );
	controls.update();
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	samplesEl = document.getElementById( 'samples' );

	const envMapPromise = new Promise( resolve => {

		new RGBELoader()
			.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

				const generator = new BlurredEnvMapGenerator( renderer );
				const blurredTex = generator.generate( texture, 0.35 );
				ptRenderer.material.envMapInfo.updateFrom( blurredTex );
				generator.dispose();
				texture.dispose();

				scene.environment = blurredTex;

				resolve();

			} );

	} );

	const generator = new PathTracingSceneWorker();
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/sd-macross-city-standoff-diorama/scene.glb' )
		.then( gltf => {

			const group = new THREE.Group();

			const geometry = new THREE.SphereBufferGeometry( 1, 10, 10 );
			const mat = new THREE.MeshStandardMaterial( {
				emissiveIntensity: 10,
				emissive: 0xffffff
			} );
			for ( let i = 0; i < 300; i ++ ) {

				const m = new THREE.Mesh(
					geometry,
					mat
				);
				m.scale.setScalar( 0.075 * Math.random() + 0.03 );
				m.position.randomDirection().multiplyScalar( 30 + Math.random() * 15 );
				group.add( m );

			}

			gltf.scene.scale.setScalar( 0.5 );
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			gltf.scene.traverse( c => {

				if ( c.material ) {

					c.material.roughness = 0.05;
					c.material.metalness = 0.05;

				}

			} );

			return generator.generate( group );

		} )
		.then( result => {

			sceneInfo = result;

			scene.add( result.scene );

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

			generator.dispose();

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );
	renderer.domElement.addEventListener( 'mouseup', onMouseUp );
	renderer.domElement.addEventListener( 'mousedown', onMouseDown );

	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( camera, 'focusDistance', 1, 100 ).onChange( reset ).listen();
	cameraFolder.add( camera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		camera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		reset();

	} );
	cameraFolder.add( camera, 'apertureRotation', 0, 12.5 ).onChange( reset );
	cameraFolder.add( camera, 'anamorphicRatio', 0.1, 10.0 ).onChange( reset );
	cameraFolder.add( camera, 'bokehSize', 0, 100 ).onChange( reset ).listen();
	cameraFolder.add( camera, 'fStop', 0.02, 20 ).onChange( reset ).listen();
	cameraFolder.add( camera, 'fov', 25, 100 ).onChange( () => {

		camera.updateProjectionMatrix();
		reset();

	} ).listen();
	cameraFolder.add( params, 'autoFocus' );

	animate();

}

function onMouseDown( e ) {

	mouse.set( e.clientX, e.clientY );

}

function onMouseUp( e ) {

	const deltaMouse = Math.abs( mouse.x - e.clientX ) + Math.abs( mouse.y - e.clientY );
	if ( deltaMouse < 2 && sceneInfo ) {

		const bvh = sceneInfo.bvh;
		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( {

			x: ( e.clientX / window.innerWidth ) * 2 - 1,
			y: - ( e.clientY / window.innerHeight ) * 2 + 1,

		}, camera );

		const hit = bvh.raycastFirst( raycaster.ray );
		if ( hit ) {

			focusPoint.copy( hit.point );
			camera.focusDistance = hit.distance - camera.near;
			ptRenderer.reset();

		}

	}

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

function reset() {

	ptRenderer.reset();

}


function animate() {

	requestAnimationFrame( animate );

	if ( params.autoFocus ) {

		camera.focusDistance = camera.position.distanceTo( focusPoint ) - camera.near;

	}

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
	ptRenderer.material.environmentIntensity = params.environmentIntensity;
	ptRenderer.material.bounces = params.bounces;
	ptRenderer.material.physicalCamera.updateFrom( camera );

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




