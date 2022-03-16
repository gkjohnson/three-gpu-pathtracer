import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingSceneGenerator } from '../src/index.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { AmbientOcclusionMaterial } from '../src/materials/AmbientOcclusionMaterial.js';

let renderer, controls, camera, material, scene;
let fsQuad, target1, target2;
let samplesEl, samples, totalSamples;
const params = {

	radius: 2.0,
	samples: 5.0,
	singleFrame: false,

};

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( { transparent: true } ) );

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( - 4, 2, 3 );

	scene = new THREE.Scene();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		reset();

	} );

	samplesEl = document.getElementById( 'samples' );

	target1 = new THREE.WebGLRenderTarget( 1, 1, { type: THREE.FloatType, encoding: THREE.LinearEncoding } );

	target2 = new THREE.WebGLRenderTarget( 1, 1, { type: THREE.FloatType, encoding: THREE.LinearEncoding } );

	material = new AmbientOcclusionMaterial();
	const generator = new PathTracingSceneGenerator();
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/material-balls/material-ball.glb' )
		.then( gltf => {

			const group = new THREE.Group();

			gltf.scene.scale.setScalar( 0.01 );
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			const floor = new THREE.Mesh(
				new THREE.CylinderBufferGeometry( 3, 3, 0.05, 200 ),
				new THREE.MeshStandardMaterial( { color: 0x1a1a1a } ),
			);
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.025;
			group.add( floor );

			return generator.generate( group );

		} )
		.then( result => {

			const { bvh } = result;
			material.bvh.updateFrom( bvh );

			const bvhMesh = new THREE.Mesh( bvh.geometry, material );
			scene.add( bvhMesh );
			generator.dispose();

		} );

	await gltfPromise;

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'samples', 1, 10, 1 );
	gui.add( params, 'radius', 0, 4 ).onChange( reset );
	gui.add( params, 'singleFrame' ).onChange( reset );

	reset();
	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	target1.setSize( w * dpr, h * dpr );
	target2.setSize( w * dpr, h * dpr );

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function reset() {

	samples = 0;
	totalSamples = 0;

}

function animate() {

	requestAnimationFrame( animate );

	material.seed ++;

	material.radius = params.radius;
	material.setDefine( 'SAMPLES', params.samples );

	if ( params.singleFrame ) {

		renderer.render( scene, camera );

	} else {

		samples ++;
		totalSamples += params.samples;

		const w = target1.width;
		const h = target1.height;
		camera.setViewOffset(
			w, h,
			Math.random() - 0.5, Math.random() - 0.5,
			w, h,
		);
		renderer.setRenderTarget( target1 );
		renderer.render( scene, camera );

		renderer.setRenderTarget( target2 );
		renderer.autoClear = false;
		fsQuad.material.map = target1.texture;
		fsQuad.material.opacity = 1 / samples;
		fsQuad.render( renderer );
		renderer.autoClear = true;

		renderer.setRenderTarget( null );
		fsQuad.material.map = target2.texture;
		fsQuad.material.opacity = 1;
		fsQuad.render( renderer );

	}

	samplesEl.innerText = `Samples: ${ totalSamples }`;

}




