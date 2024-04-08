import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingSceneGenerator } from '../src/core/PathTracingSceneGenerator.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { AmbientOcclusionMaterial } from '../src/materials/surface/AmbientOcclusionMaterial.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { MeshBVHUniformStruct } from 'three-mesh-bvh';
import * as MikkTSpace from 'three/examples/jsm/libs/mikktspace.module.js';
import { mergeVertices, computeMikkTSpaceTangents } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let renderer, controls, camera, scene, stats;
let fsQuad, target1, target2, materials;
let samplesEl, samples, totalSamples;
const params = {

	renderScale: 1 / window.devicePixelRatio,
	radius: 2.0,
	samplesPerFrame: 2.0,
	accumulate: true,
	pause: false,

};

init();

async function init() {

	// initialize renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	document.body.appendChild( renderer.domElement );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( { transparent: true } ) );

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( - 4, 2, 3 );

	scene = new THREE.Scene();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		reset();

	} );

	samplesEl = document.getElementById( 'samples' );

	// will be null if extension not supported
	const floatLinearExtensionSupported = renderer.extensions.get( 'OES_texture_float_linear' );

	// initialize render targs
	target1 = new THREE.WebGLRenderTarget( 1, 1, { type: floatLinearExtensionSupported ? THREE.FloatType : THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace } );

	target2 = new THREE.WebGLRenderTarget( 1, 1, { type: floatLinearExtensionSupported ? THREE.FloatType : THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace } );

	materials = [];


	const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( async gltf => {

			const group = new THREE.Group();

			// scale the scene to a reasonable size
			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			const sphere = new THREE.Sphere();
			box.getBoundingSphere( sphere );

			gltf.scene.scale.setScalar( 2.5 / sphere.radius );
			gltf.scene.position.y = - 0.25 * ( box.max.y - box.min.y ) * 2.5 / sphere.radius;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			// position the floor
			box.setFromObject( gltf.scene );

			const floor = new THREE.Mesh(
				new THREE.CylinderGeometry( 3, 3, 0.05, 200 ),
				new THREE.MeshStandardMaterial( { color: 0x1a1a1a } ),
			);
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.025;
			group.add( floor );

			await MikkTSpace.ready;

			// requires bundle support for top level await
			group.traverse( c => {

				if ( c.geometry ) {

					const geometry = c.geometry;

					if ( ! ( 'tangent' in geometry.attributes ) && 'normal' in geometry.attributes && 'uv' in geometry.attributes ) {

						c.geometry = computeMikkTSpaceTangents( geometry, MikkTSpace );
						c.geometry = mergeVertices( geometry );

					}

				}

			} );

			group.updateMatrixWorld( true );

			return {
				...new PathTracingSceneGenerator( group ).generate(),
				scene: group,
			};

		} )
		.then( result => {

			const { bvh } = result;

			const bvhUniform = new MeshBVHUniformStruct();
			bvhUniform.updateFrom( bvh );

			// TODO: for some reason creating multiple materials _really_ slows down the rendering?
			const materialMap = new Map();
			const group = result.scene;
			group.traverse( c => {

				// reuse materials as much as possible since different ones cause slow down
				if ( c.isMesh ) {

					const normalMap = c.material.normalMap;
					if ( ! materialMap.has( normalMap ) ) {

						const material = new AmbientOcclusionMaterial( {

							bvh: bvhUniform,
							normalScale: c.material.normalScale,
							normalMap,
							normalMapType: c.material.normalMapType,

						} );
						materialMap.set( normalMap, material );
						materials.push( material );

					}

					c.material = materialMap.get( normalMap );

				}

			} );
			scene.add( group );

		} );

	await gltfPromise;

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'renderScale', 0.1, 1 ).onChange( onResize );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'radius', 0, 4 ).onChange( reset );
	gui.add( params, 'accumulate' ).onChange( reset );
	gui.add( params, 'pause' );

	stats = new Stats();
	document.body.appendChild( stats.domElement );

	reset();
	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio * params.renderScale;

	target1.setSize( w * dpr, h * dpr );
	target2.setSize( w * dpr, h * dpr );

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	reset();

}

function reset() {

	samples = 0;
	totalSamples = 0;

}

function animate() {

	requestAnimationFrame( animate );

	stats.update();

	// update all the material parameters
	materials.forEach( material => {

		if ( ! params.pause ) {

			material.seed ++;

		}

		material.radius = params.radius;
		material.setDefine( 'SAMPLES', params.samplesPerFrame );

	} );

	// update the render targets if it's a first frame or not paused
	if ( samples === 0 || ! params.pause ) {

		samples ++;
		totalSamples += params.samplesPerFrame;

		if ( params.accumulate && ! params.pause ) {

			const w = target1.width;
			const h = target1.height;
			camera.setViewOffset(
				w, h,
				Math.random() - 0.5, Math.random() - 0.5,
				w, h,
			);

		}

		renderer.setRenderTarget( target1 );
		renderer.render( scene, camera );

		renderer.setRenderTarget( target2 );
		renderer.autoClear = false;
		fsQuad.material.map = target1.texture;
		fsQuad.material.opacity = params.accumulate ? 1 / samples : 1;
		fsQuad.render( renderer );
		renderer.autoClear = true;

	}

	// render to screen
	renderer.setRenderTarget( null );
	fsQuad.material.map = target2.texture;
	fsQuad.material.opacity = 1;
	fsQuad.render( renderer );

	samplesEl.innerText = `Samples: ${ totalSamples }`;

}




