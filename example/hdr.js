import {
	Scene,
	EquirectangularReflectionMapping,
	WebGPURenderer,
	PerspectiveCamera,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
	DoubleSide,
	Color,
	ACESFilmicToneMapping,
	NoToneMapping,
	HalfFloatType,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { HDRImageGenerator } from './utils/HDRImageGenerator.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getScaledSettings } from './utils/getScaledSettings.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/MER_static.glb';
const CREDITS = 'Model courtesy of NASA/Caltech-JPL';
const DESCRIPTION = window.matchMedia( '(dynamic-range: high)' ).matches ? 'HDR display supported' : 'HDR display not supported';

const MAX_SAMPLES = 45;

const params = {
	pause: false,
	hdr: true,
	environmentIntensity: 15,
	renderScale: 1,
	downloadHDR: () => downloadImage(),

	...getScaledSettings(),
};

let pathTracer, renderer, controls;
let camera, scene;
let loader, hdrGenerator;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );


	// renderer
	// outputType HalfFloatType configures the canvas for extended-range tone mapping, so the path
	// tracer's linear values above 1.0 are displayed directly in HDR ( on a capable display ).
	renderer = new WebGPURenderer( { antialias: true, outputType: HalfFloatType } );
	renderer.init();
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.minSamples = 1;
	pathTracer.renderScale = params.renderScale;
	pathTracer.tiles.set( params.tiles, params.tiles );

	// generator
	hdrGenerator = new HDRImageGenerator( renderer );

	// camera
	camera = new PerspectiveCamera( 50, 1, 0.025, 500 );
	camera.position.set( 20, 24, 35 ).multiplyScalar( 0.8 );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.1;
	scene.background = new Color( 0x111111 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 6;
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();

	} );
	controls.update();

	// load the environment map and model
	const [ gltf, envTexture ] = await Promise.all( [
		new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( MODEL_URL ),
		new HDRLoader().loadAsync( ENV_URL ),
	] );

	envTexture.mapping = EquirectangularReflectionMapping;
	scene.environment = envTexture;
	scene.environmentIntensity = params.environmentIntensity;

	const model = gltf.scene;
	model.scale.setScalar( 10 );
	scene.add( model );

	const floorTex = generateRadialFloorTexture( 2048 );
	const floorPlane = new Mesh(
		new PlaneGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0x111111,
			roughness: 0.1,
			metalness: 0.1,
			side: DoubleSide,
		} ),
	);
	floorPlane.scale.setScalar( 50 );
	floorPlane.rotation.x = - Math.PI / 2;
	scene.add( floorPlane );

	// initialize the path tracer
	pathTracer.setScene( scene, camera );

	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );
	loader.setPercentage( 1 );

	const gui = new GUI();
	gui.add( params, 'hdr' ).onChange( v => {

		renderer.toneMapping = v ? NoToneMapping : ACESFilmicToneMapping;

	} );
	gui.add( params, 'pause' );
	gui.add( params, 'renderScale', 0.1, 1 ).onChange( v => {

		pathTracer.renderScale = v;
		pathTracer.reset();

	} );
	gui.add( params, 'environmentIntensity', 0, 30 ).onChange( v => {

		scene.environmentIntensity = v;
		pathTracer.updateEnvironment();

	} );
	gui.add( params, 'downloadHDR' ).name( 'Download HDR' );

	window.addEventListener( 'resize', onResize );

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

let downloading = false;
async function downloadImage() {

	// readback + gainmap encode takes a moment, so guard against overlapping downloads
	if ( downloading ) {

		return;

	}

	downloading = true;

	try {

		const blob = await hdrGenerator.generateBlob( pathTracer.target );
		const url = URL.createObjectURL( blob );

		const anchor = document.createElement( 'a' );
		anchor.href = url;
		anchor.download = 'pathtraced.jpg';
		document.body.appendChild( anchor );
		anchor.click();
		anchor.remove();

		URL.revokeObjectURL( url );

	} finally {

		downloading = false;

	}

}

function animate() {

	requestAnimationFrame( animate );

	const doPause = params.pause && pathTracer.samples >= 1;
	pathTracer.pause = pathTracer.samples >= MAX_SAMPLES || doPause;
	pathTracer.renderSample();

	loader.setSamples( pathTracer.samples, pathTracer.getDetailedSampleCount() );

}
