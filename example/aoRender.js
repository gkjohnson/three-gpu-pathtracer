import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingSceneGenerator } from '../src/index.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { AmbientOcclusionMaterial } from '../src/materials/AmbientOcclusionMaterial.js';

let renderer, controls, sceneInfo, camera, fsQuad, material, scene;
let samplesEl;
const params = {

	radius: 1.0,
	samples: 5.0,
	randomize: true,

};

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	document.body.appendChild( renderer.domElement );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( { transparent: true } ) );

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( - 4, 2, 3 );

	scene = new THREE.Scene();

	controls = new OrbitControls( camera, renderer.domElement );

	samplesEl = document.getElementById( 'samples' );

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

			sceneInfo = result;
			sceneInfo.scene.add( new THREE.DirectionalLight() );

			const { bvh, textures, materials } = result;
			const geometry = bvh.geometry;

			material.bvh.updateFrom( bvh );
			material.normalAttribute.updateFrom( geometry.attributes.normal );
			material.tangentAttribute.updateFrom( geometry.attributes.tangent );
			material.uvAttribute.updateFrom( geometry.attributes.uv );
			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
			material.textures.setTextures( renderer, 2048, 2048, textures );
			material.materials.updateFrom( materials, textures );
			material.setDefine( 'MATERIAL_LENGTH', materials.length );

			const bvhMesh = new THREE.Mesh( bvh.geometry, material );
			scene.add( bvhMesh );
			generator.dispose();

		} );

	await gltfPromise;

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'samples', 1, 30, 1 );
	gui.add( params, 'radius', 0, 5 );
	gui.add( params, 'randomize', 0, 5 );

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function animate() {

	requestAnimationFrame( animate );

	if ( params.randomize ) {

		material.seed ++;

	}

	material.radius = params.radius;
	material.setDefine( 'SAMPLES', params.samples );
	renderer.render( scene, camera );

	// samplesEl.innerText = `Samples: ${ ptRenderer.samples }`;

}




