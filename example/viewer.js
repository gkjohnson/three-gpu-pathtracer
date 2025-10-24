import {
	ACESFilmicToneMapping,
	Scene,
	EquirectangularReflectionMapping,
	WebGLRenderer,
	PerspectiveCamera,
	Box3,
	Vector3,
	Group,
	LoadingManager,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { WebGLPathTracer } from '..';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';

let pathTracer, renderer, controls;
let camera, scene;
let loader, modelContainer;
let isModelLoaded = false;

const dropZone = document.getElementById( 'drop-zone' );

init();

async function init() {

	const { tiles, renderScale } = getScaledSettings();

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.5;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.renderScale = renderScale;
	pathTracer.tiles.set( tiles, tiles );

	// camera
	camera = new PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0, 0, 4 );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.05;
	scene.environmentIntensity = 3;

	modelContainer = new Group();
	scene.add( modelContainer );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

	// environment
	const envTexture = await new RGBELoader().loadAsync( ENV_URL ).then( tex => {

		tex.mapping = EquirectangularReflectionMapping;
		return tex;

	} );

	scene.background = envTexture;
	scene.environment = envTexture;

	// initialize the path tracer
	pathTracer.setScene( scene, camera );
	loader.setPercentage( 1 );

	// listeners
	window.addEventListener( 'resize', onResize );

	window.addEventListener( 'dragover', e => {

		e.preventDefault();
		if ( ! isModelLoaded ) {

			dropZone.classList.add( 'drag-over' );

		}

	} );

	window.addEventListener( 'dragleave', e => {

		if ( e.relatedTarget === null || e.relatedTarget === document.documentElement ) {

			dropZone.classList.remove( 'drag-over' );

		}

	} );

	window.addEventListener( 'drop', e => {

		e.preventDefault();
		dropZone.classList.remove( 'drag-over' );

		const files = e.dataTransfer.files;
		if ( files.length > 0 ) {

			dropZone.innerText = 'Loading...';
			dropZone.classList.remove( 'hidden' );

			const fileMap = new Map();
			let rootUrl = null;

			for ( const file of files ) {

				const url = URL.createObjectURL( file );
				fileMap.set( file.name, url );

				if ( file.name.match( /\.gltf$/i ) ) {

					rootUrl = url;

				}

			}

			const loadingManager = new LoadingManager();
			loadingManager.setURLModifier( url => fileMap.get( url.split( '/' ).pop() ) || url );

			const loader = new GLTFLoader( loadingManager );
			const onLoad = gltf => {

				modelContainer.clear();
				modelContainer.add( gltf.scene );

				const box = new Box3().setFromObject( gltf.scene );
				const center = box.getCenter( new Vector3() );
				const size = box.getSize( new Vector3() );

				gltf.scene.position.sub( center );

				const maxDim = Math.max( size.x, size.y, size.z );
				const fov = camera.fov * ( Math.PI / 180 );
				camera.position.z = maxDim / ( 2 * Math.tan( fov / 2 ) );
				camera.position.z *= 1.5;
				
				camera.near = maxDim / 100;
				camera.far = maxDim * 10;
				camera.updateProjectionMatrix();

				controls.target.set( 0, 0, 0 );
				controls.update();

				pathTracer.setScene( scene, camera );

				dropZone.innerText = 'Drop GLTF/GLB file here';
				dropZone.classList.add( 'hidden' );
				isModelLoaded = true;

				fileMap.forEach( url => URL.revokeObjectURL( url ) );

			};

			if ( rootUrl ) {

				loader.load( rootUrl, onLoad );

			} else {

				const file = files[ 0 ];
				const reader = new FileReader();
				reader.onload = e => {

					loader.parse( e.target.result, '', onLoad );

				};
				reader.readAsArrayBuffer( file );

			}

		}

	} );

	onResize();
	animate();

}

function onResize() {

	// update resolution
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	// update camera
	pathTracer.updateCamera();

}

function animate() {

	requestAnimationFrame( animate );

	if ( isModelLoaded ) {

		pathTracer.renderSample();

		loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

	}

}