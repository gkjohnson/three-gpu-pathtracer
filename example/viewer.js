import {
	ACESFilmicToneMapping,
	NoToneMapping,
	Scene,
	EquirectangularReflectionMapping,
	WebGLRenderer,
	PerspectiveCamera,
	Box3,
	Vector2,
	Vector3,
	Group,
	LoadingManager,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/worker';

const params = {

	isWebGPU: false,
	useMegakernel: true,
	enable: true,
	bounces: 10,
	transmissiveBounces: 10,
	pause: false,
	multipleImportanceSampling: true,
	acesToneMapping: true,
	scale: 1 / window.devicePixelRatio,
	tiles: 2,
	iterationsPerFrame: 1,

};

let gui;

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';

let pathTracer, renderer, controls;
let camera, scene;
let loader, modelContainer;
let isModelLoaded = false;
let delaySamples = 0;
let detailedSampleCount = null;
let lastDetailedSample = 0;
const detailedSampleInterval = 30;

const dropZone = document.getElementById( 'drop-zone' );

init();

async function createRenderer( isWebGPU ) {

	if ( isWebGPU ) {

		renderer = new WebGPURenderer( { antialias: true, trackTimestamp: false } );
		await renderer.init();
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.setClearAlpha( 0 );
		document.body.appendChild( renderer.domElement );

		pathTracer = new WebGPUPathTracer( renderer );
		pathTracer.useMegakernel( params.useMegakernel );
		if ( params.useMegakernel ) {

			pathTracer._pathTracer.tiles.set( params.tiles, params.tiles );

		}

	} else {

		renderer = new WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
		renderer.physicallyCorrectLights = true;
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.toneMappingExposure = 0.5;
		renderer.setClearAlpha( 0 );
		document.body.appendChild( renderer.domElement );

		pathTracer = new WebGLPathTracer( renderer );
		pathTracer.filterGlossyFactor = 0.5;
		pathTracer.renderScale = params.scale;
		pathTracer.tiles.set( params.tiles, params.tiles );
		pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
		pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
		pathTracer.bounces = params.bounces;
		pathTracer.transmissiveBounces = params.transmissiveBounces;

	}

}

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	await createRenderer( params.isWebGPU );

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
	const envTexture = await new HDRLoader().loadAsync( ENV_URL ).then( tex => {

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

			const dracoLoader = new DRACOLoader();
			dracoLoader.setDecoderPath( 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/' );

			const ktx2Loader = new KTX2Loader();
			ktx2Loader.setTranscoderPath( 'https://cdn.jsdelivr.net/npm/three@0.181.1/examples/jsm/libs/basis/' );
			ktx2Loader.detectSupport( renderer );

			const loader = new GLTFLoader( loadingManager );
			loader.setDRACOLoader( dracoLoader );
			loader.setKTX2Loader( ktx2Loader );
			const onLoad = gltf => {

				modelContainer.clear();
				modelContainer.add( gltf.scene );

				const box = new Box3().setFromObject( gltf.scene );
				const center = box.getCenter( new Vector3() );
				const size = box.getSize( new Vector3() );

				gltf.scene.position.sub( center );

				const maxDim = Math.max( size.x, size.y, size.z );
				const fov = camera.fov * ( Math.PI / 180 );
				const distance = maxDim / ( 2 * Math.tan( fov / 2 ) ) * 1.5;
				camera.position.set( 0, 0, distance );

				camera.near = maxDim / 100;
				camera.far = maxDim * 10;
				camera.updateProjectionMatrix();

				controls.target.set( 0, 0, 0 );
				controls.update();

				pathTracer.setScene( scene, camera );

				dropZone.innerText = 'Drop GLTF/GLB file here';
				dropZone.classList.add( 'hidden' );
				isModelLoaded = true;
				buildGui();

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

function onParamsChange() {

	if ( pathTracer.tiles !== 1.0 ) {

		delaySamples = 1;

	}

	if ( ! params.isWebGPU ) {

		pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
		pathTracer.bounces = params.bounces;
		pathTracer.transmissiveBounces = params.transmissiveBounces;
		pathTracer.renderScale = params.scale;

	}

	renderer.toneMapping = params.acesToneMapping ? ACESFilmicToneMapping : NoToneMapping;

}

function buildGui() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	const pathTracingFolder = gui.addFolder( 'Path Tracer' );

	let webgpuOptions = null;
	pathTracingFolder.add( params, 'isWebGPU' ).onChange( v => {

		const size = renderer.getSize( new Vector2() );
		pathTracer.dispose();
		document.body.removeChild( renderer.domElement );
		renderer.dispose();

		webgpuOptions.show( v );

		createRenderer( v ).then( () => {

			renderer.setSize( size.x, size.y );
			renderer.setPixelRatio( window.devicePixelRatio );
			pathTracer.setScene( scene, camera );

			onParamsChange();

		} );

	} );

	webgpuOptions = pathTracingFolder.add( params, 'useMegakernel' );
	webgpuOptions.onChange( () => {

		pathTracer.useMegakernel( params.useMegakernel );
		pathTracer.reset();

	} );
	webgpuOptions.show( params.isWebGPU );

	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'scale', 0.1, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'tiles', 1, 10, 1 ).onChange( v => {

		const tiles = pathTracer.tiles ?? pathTracer._pathTracer.tiles;
		if ( tiles ) {

			tiles.set( v, v );

		}

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'transmissiveBounces', 1, 20, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'iterationsPerFrame', 1, 30, 1 );

}

function animate() {

	requestAnimationFrame( animate );

	if ( pathTracer.getRenderTime && pathTracer.getDetailedSampleCount ) {

		const elapsed = pathTracer.getRenderTime() / 1000;
		if ( elapsed < detailedSampleInterval ) {

			detailedSampleCount = null;
			lastDetailedSample = 0;

		}

		if ( elapsed - lastDetailedSample > detailedSampleInterval ) {

			lastDetailedSample = Math.floor( elapsed / detailedSampleInterval ) * detailedSampleInterval;
			pathTracer.getDetailedSampleCount().then( sampleCount => {

				sampleCount.perSecond = sampleCount.avg / elapsed;
				detailedSampleCount = sampleCount;

			} );

		}

	}

	if ( params.enable && delaySamples === 0 ) {

		pathTracer.enablePathTracing = params.enable;
		pathTracer.pausePathTracing = params.pause;

		for ( let i = 0; i < params.iterationsPerFrame; i ++ ) {

			pathTracer.renderSample();

		}

	} else if ( ( delaySamples > 0 || ! params.enable ) && renderer.initialized !== false ) {

		delaySamples = Math.max( delaySamples - 1, 0 );
		renderer.render( scene, camera );

	}

	if ( isModelLoaded ) {

		loader.setSamples( pathTracer.samples, pathTracer.isCompiling, detailedSampleCount );

	}

}
