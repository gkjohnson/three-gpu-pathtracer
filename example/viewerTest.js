import {
	ACESFilmicToneMapping,
	NoToneMapping,
	LoadingManager,
	WebGLRenderer,
	Scene,
	PerspectiveCamera,
	EquirectangularReflectionMapping,
	MathUtils,
	Group,
	Sphere,
	Box3,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { WebGLPathTracer } from '../src/index.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { LoaderElement } from './utils/LoaderElement.js';

const CONFIG_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json';
const BASE_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config/';

const urlParams = new URLSearchParams( window.location.search );
const maxSamples = parseInt( urlParams.get( 'samples' ) ) || - 1;
const hideUI = urlParams.get( 'hideUI' ) === 'true';
const tiles = parseInt( urlParams.get( 'tiles' ) ) || 2;
const scale = parseInt( urlParams.get( 'scale' ) ) || 1 / window.devicePixelRatio;

const params = {

	enable: true,
	bounces: 10,
	transmissiveBounces: 10,
	pause: false,
	multipleImportanceSampling: true,
	acesToneMapping: true,
	tiles: tiles,
	scale: scale,

	model: '',
	checkerboardTransparency: true,
	displayImage: false,
	imageMode: 'overlay',
	imageOpacity: 1.0,
	imageType: 'dspbr-pt',

};

let containerEl, imgEl, loader;
let gui, model, envMap;
let pathTracer, renderer, camera, scene, controls;
let loadingModel = false;
let delaySamples = 0;
let modelDatabase;

init();

async function init() {

	// get elements
	containerEl = document.getElementById( 'container' );
	imgEl = document.querySelector( 'img' );

	if ( hideUI ) {

		containerEl.style.background = 'transparent';
		document.body.style.background = 'transparent';

	}

	loader = new LoaderElement();
	if ( ! hideUI ) {

		loader.attach( document.body );

	}

	// renderer
	renderer = new WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
	renderer.physicallyCorrectLights = true;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.setClearAlpha( 0 );
	containerEl.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.tiles.set( params.tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;

	// scene
	scene = new Scene();

	// init camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PerspectiveCamera( 60, aspect, 0.01, 500 );
	camera.position.set( - 1, 0.25, 1 );

	// controls
	controls = new OrbitControls( camera, containerEl );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );

	// models
	const { scenarios } = await fetch( CONFIG_URL ).then( res => res.json() );
	modelDatabase = {};
	scenarios.forEach( s => modelDatabase[ s.name ] = s );

	window.addEventListener( 'hashchange', onHashChange );
	onHashChange();

	animate();

}

function animate() {

	requestAnimationFrame( animate );

	// if rendering has completed then don't render
	if ( pathTracer.samples >= maxSamples && maxSamples !== - 1 ) {

		return;

	}

	imgEl.style.display = ! params.displayImage ? 'none' : 'inline-block';
	imgEl.style.opacity = params.imageMode === 'side-by-side' ? 1.0 : params.imageOpacity;
	imgEl.style.position = params.imageMode === 'side-by-side' ? 'initial' : 'absolute';
	imgEl.style.width = renderer.domElement.style.width;
	imgEl.style.height = renderer.domElement.style.height;

	if ( loadingModel ) {

		return;

	}

	// TODO: use a delay field from WebGLPathTracer
	if ( params.enable && delaySamples === 0 ) {

		pathTracer.enablePathTracing = params.enable;
		pathTracer.pausePathTracing = params.pause || pathTracer.samples > maxSamples && maxSamples !== - 1;

		pathTracer.renderSample();

	} else if ( delaySamples > 0 || ! params.enable ) {

		delaySamples = Math.max( delaySamples - 1, 0 );
		renderer.render( scene, camera );

	}

	// rendering has completed
	if ( pathTracer.samples >= maxSamples && maxSamples !== - 1 ) {

		requestAnimationFrame( () => window.dispatchEvent( new Event( 'render-complete' ) ) );

	}

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}

function onHashChange() {

	params.model = Object.keys( modelDatabase )[ 0 ];
	if ( window.location.hash ) {

		const modelName = window.location.hash.substring( 1 ).replaceAll( '%20', ' ' );
		if ( modelName in modelDatabase ) {

			params.model = modelName;

		}

	}

	updateModel();

}

function onParamsChange() {

	if ( pathTracer.tiles !== 1.0 ) {

		delaySamples = 1;

	}

	if ( params.checkerboardTransparency ) {

		containerEl.classList.add( 'checkerboard' );

	} else {

		containerEl.classList.remove( 'checkerboard' );

	}

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.bounces = params.bounces;
	pathTracer.transmissiveBounces = params.transmissiveBounces;
	pathTracer.renderScale = params.scale;

	const model = modelDatabase[ params.model ];
	scene.background = model && model.renderSkybox ? scene.environment : null;
	pathTracer.updateEnvironment();

}

function buildGui() {

	if ( hideUI ) {

		return;

	}

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();
	gui.add( params, 'model', Object.keys( modelDatabase ) ).onChange( v => {

		window.location.hash = v;

	} );

	const pathTracingFolder = gui.addFolder( 'Path Tracer' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'scale', 0.1, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( v => {

		renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;

	} );
	pathTracingFolder.add( params, 'tiles', 1, 10, 1 ).onChange( v => {

		pathTracer.tiles.set( v, v );

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'transmissiveBounces', 1, 20, 1 ).onChange( onParamsChange );

	const comparisonFolder = gui.addFolder( 'Comparison' );
	comparisonFolder.add( params, 'displayImage' );
	comparisonFolder.add( params, 'imageMode', [ 'overlay', 'side-by-side' ] );
	comparisonFolder.add( params, 'imageType', [
		'dspbr-pt',
		'filament',
		'babylon',
		'gltf-sample-viewer',
		'model-viewer',
		'rhodonite',
		'stellar'
	] ).onChange( updateImage );
	comparisonFolder.add( params, 'imageOpacity', 0, 1.0 );
	comparisonFolder.add( params, 'checkerboardTransparency' ).onChange( onParamsChange );

}

async function updateModel() {

	// dispose of a gui
	if ( gui ) {

		containerEl.classList.remove( 'checkerboard' );
		gui.destroy();
		gui = null;

	}

	// dispose of everything
	if ( model ) {

		model.traverse( c => {

			if ( c.material ) {

				const material = c.material;
				for ( const key in material ) {

					if ( material[ key ] && material[ key ].isTexture ) {

						material[ key ].dispose();

					}

				}

			}

		} );

		scene.remove( model );

	}

	// dispose of the background
	if ( envMap ) {

		envMap.dispose();

	}

	const modelInfo = modelDatabase[ params.model ];
	const {
		verticalFoV = 45,
		lighting = '../../../shared-assets/environments/lightroom_14b.hdr',
	} = modelInfo;

	let {
		orbit = {},
		target = {},
		dimensions = {},
	} = modelInfo;

	orbit = { theta: 0, phi: 90, radius: 1, ...orbit };
	target = { x: 0, y: 0, z: 0, ...target };
	dimensions = { width: 768, height: 768, ...dimensions };

	// add a minimal radius so the camera orientation is correct when radius is 0
	orbit.radius = Math.max( orbit.radius, 1e-5 );

	loadingModel = true;
	containerEl.style.display = 'none';

	// load assets
	const envUrl = new URL( lighting, BASE_URL ).toString();
	const modelUrl = new URL( modelInfo.model, BASE_URL )
		.toString()
		.replace( /.*?glTF-Sample-Assets/, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main' );

	const manager = new LoadingManager();
	const [ envTexture, gltf ] = await Promise.all( [
		new RGBELoader( manager ).loadAsync( envUrl ),
		new GLTFLoader( manager ).setMeshoptDecoder( MeshoptDecoder )
			.loadAsync( modelUrl, progress => {

				if ( progress.total !== 0 && progress.total >= progress.loaded ) {

					loader.setPercentage( 0.5 * progress.loaded / progress.total );

				}

			} ),
		new Promise( resolve => manager.onLoad = resolve ),
	] );

	envMap = envTexture;
	envMap.mapping = EquirectangularReflectionMapping;
	scene.environment = envMap;

	model = gltf.scene;

	const targetsToDisconnect = [];
	model.traverse( c => {

		if ( c.isLight && c.target ) {

			targetsToDisconnect.push( c.target );

		}

	} );

	// disconnect all light targets from parents because that's what happens after a clone which
	// is needed to match the model viewer setup
	targetsToDisconnect.forEach( t => t.removeFromParent() );

	// add a parent group to process the parent offset
	const targetGroup = new Group();
	targetGroup.position.set( - target.x, - target.y, - target.z );
	targetGroup.add( model );

	// replace the target group TODO
	model = targetGroup;
	model.updateMatrixWorld( true );
	scene.add( model );

	const box = new Box3();
	const sphere = new Sphere();
	box.setFromObject( model );
	box.getBoundingSphere( sphere );

	// mirror the model-viewer near / far planes
	const radius = Math.max( orbit.radius, sphere.radius );
	camera.near = 2 * radius / 1000;
	camera.far = 2 * radius;
	camera.updateProjectionMatrix();
	camera.position.setFromSphericalCoords( orbit.radius, MathUtils.DEG2RAD * orbit.phi, MathUtils.DEG2RAD * orbit.theta );

	// initialize the canvas size
	const { width, height } = dimensions;
	renderer.setSize( width, height );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = width / height;
	camera.fov = verticalFoV;
	camera.updateProjectionMatrix();
	controls.update();

	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => {

			loader.setPercentage( 0.5 + 0.5 * v );

		}
	} );

	loader.setCredits( modelInfo.credit || '' );
	containerEl.style.display = 'flex';
	loadingModel = false;

	onParamsChange();
	buildGui();
	updateImage();

}

function updateImage() {

	imgEl.src = `https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/goldens/${ params.model }/${ params.imageType }-golden.png`;

}
