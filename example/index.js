import {
	ACESFilmicToneMapping,
	Box3,
	Group,
	LoadingManager,
	Sphere,
	DoubleSide,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	Scene,
	OrthographicCamera,
	Vector3,
	WebGPURenderer,
	EquirectangularReflectionMapping,
	RectAreaLight,
	RectAreaLightNode,
} from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './src/generateRadialFloorTexture.js';
import { GradientEquirectTexture, PhysicalCamera } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getScaledSettings } from './src/getScaledSettings.js';
import { LoaderElement } from './src/LoaderElement.js';
import { Backdrop } from './src/Backdrop.js';
import { MODEL_LIST } from './modelList.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';

/**
 * Limits requested by this application.
 *
 * Add required limits here.
 *
 */
const DEVICE_LIMITS_REQUESTED = [
	'maxBufferSize',
	'maxStorageBufferBindingSize',
];

const DESCRIPTION = 'Drag and drop a GLTF, GLB, DAE, or MPD file to view it.';

const DEFAULT_FOV = 45;

// aperture diameter in millimetres, where zero is a pinhole and disables the effect entirely
const DEFAULT_BOKEH_SIZE = 0;

// "?lightHelpers=true" outlines the rect area lights so a rig can be positioned visually
const SHOW_LIGHT_HELPERS = new URLSearchParams( window.location.search ).get( 'lightHelpers' ) === 'true';

// how far behind the model the backdrop's curve begins
const BACKDROP_DISTANCE = 1;

// stage lighting rigs built from rect area lights
const LIGHT_RIGS = {
	'three point': [
		{ size: 2, position: [ 2, 1.6, 1.8 ], intensity: 6, color: 0xfff0dd },
		{ size: 2.5, position: [ - 2.4, 0.8, 1.6 ], intensity: 1.5, color: 0xdfeaff },
		{ size: 1.6, position: [ - 1.2, 1.8, - 2.2 ], intensity: 9, color: 0xffffff },
	],
	// taken from the Coffee Maker scene
	softbox: [
		{ size: [ 2.1, 2.5 ], position: [ - 1.55, 0.35, 0.9 ], intensity: 2, color: 0xffffff },
		{ size: [ 2.5, 2 ], position: [ 1.8, 0.5, 0.25 ], intensity: 2, color: 0xffffff },
		{ size: 2.55, position: [ 0, 1.9, 0.2 ], intensity: 2, color: 0xffffff },
	],
	overhead: [
		{ size: 3, position: [ 0, 2.4, 0.4 ], intensity: 8, color: 0xffffff },
	],
	'side strips': [
		{ size: [ 0.5, 3.2 ], position: [ - 2.2, 1, 0.4 ], intensity: 14, color: 0xffffff },
		{ size: [ 0.5, 3.2 ], position: [ 2.2, 1, 0.4 ], intensity: 14, color: 0xffffff },
	],
	// taken from the Sasha ring scene
	'light box': [
		{ size: [ 3.55, 8.8 ], position: [ 0.65, 1.75, - 3.45 ], rotation: [ - Math.PI / 2, 0, 0 ], intensity: 5, color: 0xffffff },
		{ size: [ 1.65, 7.7 ], position: [ - 1.8, 0.6, - 2.8 ], rotation: [ 0, - Math.PI / 2, 0 ], intensity: 3, color: 0xffffff },
		{ size: [ 1.65, 1.7 ], position: [ 2.25, 0.6, 0.2 ], rotation: [ 0, Math.PI / 2, 0 ], intensity: 3, color: 0xffffff },
		{ size: [ 1.7, 2.8 ], position: [ 0.1, 1.15, 2.4 ], rotation: [ 0, 0, 0 ], intensity: 3, color: 0xffffff },
	],
	// taken from the Magie Noire scene - a white key with warm and cool accents
	'colored three point': [
		{ size: 0.19, position: [ 0.25, 0.06, 0.29 ], rotation: [ - 0.071, - 0.275, - 0.266 ], intensity: 25, color: 0xffffff },
		{ size: 0.19, position: [ 0.59, 0.06, - 0.03 ], rotation: [ - 0.826, 1.176, - 0.452 ], intensity: 12.5, color: 0xe29e49 },
		{ size: 0.19, position: [ 0.24, - 0.1, - 0.32 ], rotation: [ Math.PI / 2, 0, 0 ], intensity: 15, color: 0x8f70f3 },
	],
	'overhead strips': [
		{ size: [ 0.35, 3.4 ], position: [ - 0.9, 2.4, 0 ], rotation: [ - Math.PI / 2, 0, 0 ], intensity: 12, color: 0xffffff },
		{ size: [ 0.35, 3.4 ], position: [ - 0.3, 2.4, 0 ], rotation: [ - Math.PI / 2, 0, 0 ], intensity: 12, color: 0xffffff },
		{ size: [ 0.35, 3.4 ], position: [ 0.3, 2.4, 0 ], rotation: [ - Math.PI / 2, 0, 0 ], intensity: 12, color: 0xffffff },
		{ size: [ 0.35, 3.4 ], position: [ 0.9, 2.4, 0 ], rotation: [ - Math.PI / 2, 0, 0 ], intensity: 12, color: 0xffffff },
	],
};

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.181.1/examples/jsm/libs/basis/';
const MODEL_FILE_REGEX = /\.(gltf|glb|dae|mpd)$/i;

// sentinel for models that light themselves and should not get an environment
const NO_ENVIRONMENT = 'none';

const envMaps = {
	'none': NO_ENVIRONMENT,
	'Royal Esplanade': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/royal_esplanade_1k.hdr',
	'Moonless Golf': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/moonless_golf_1k.hdr',
	'Overpass': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
	'Venice Sunset': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/venice_sunset_1k.hdr',
	'Small Studio': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr',
	'Pfalzer Forest': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/phalzer_forest_01_1k.hdr',
	'Leadenhall Market': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr',
	'Kloppenheim': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/kloppenheim_05_1k.hdr',
	'Hilly Terrain': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/hilly_terrain_01_1k.hdr',
	'Circus Arena': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/circus_arena_1k.hdr',
	'Chinese Garden': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr',
	'Autoshop': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/autoshop_01_1k.hdr',

	'Measuring Lab': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/vintage_measuring_lab_2k.hdr',
	'Whale Skeleton': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/whale_skeleton_2k.hdr',
	'Hall of Mammals': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/hall_of_mammals_2k.hdr',

	'Drachenfels Cellar': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/drachenfels_cellar_2k.hdr',
	'Adams Place Bridge': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/adams_place_bridge_2k.hdr',
	'Sepulchral Chapel Rotunda': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/sepulchral_chapel_rotunda_2k.hdr',
	'Peppermint Powerplant': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/peppermint_powerplant_2k.hdr',
	'Noon Grass': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/noon_grass_2k.hdr',
	'Narrow Moonlit Road': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/narrow_moonlit_road_2k.hdr',
	'St Peters Square Night': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/st_peters_square_night_2k.hdr',
	'Brown Photostudio 01': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/brown_photostudio_01_2k.hdr',
	'Rainforest Trail': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/rainforest_trail_2k.hdr',
	'Brown Photostudio 07': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/brown_photostudio_07_2k.hdr',
	'Brown Photostudio 06': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/brown_photostudio_06_2k.hdr',
	'Dancing Hall': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/dancing_hall_2k.hdr',
	'Aristea Wreck Puresky': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr',
	'Modern Buildings 2': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/modern_buildings_2_2k.hdr',
	'Thatch Chapel': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/thatch_chapel_2k.hdr',
	'Vestibule': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/vestibule_2k.hdr',
	'Blocky Photo Studio': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/blocky_photo_studio_1k.hdr',
	'Christmas Photo Studio 07': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/christmas_photo_studio_07_2k.hdr',
	'Aerodynamics Workshop': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aerodynamics_workshop_1k.hdr',

};

const params = {

	multipleImportanceSampling: true,
	renderScale: 1,
	tiles: 2,

	model: '',

	envMap: envMaps[ 'Aristea Wreck Puresky' ],

	cameraProjection: 'Perspective',

	stage: 'floor',

	background: 'white',

	lighting: 'none',

	enable: true,
	bounces: 15,
	pause: false,

	bokehSize: DEFAULT_BOKEH_SIZE,
	focusDistance: 1,

	...getScaledSettings(),

};

let floorPlane, pedestal, pedestalMaterial, backdrop, lightRigs, gui, stats;
let pathTracer, renderer, orthoCamera, perspectiveCamera, activeCamera;
let controls, scene, model;
let gradientMap;
let loader;
let models;

// a model loaded from a url or dropped file, which is displayed instead of a list entry
let customModel = null;

const dropZone = document.getElementById( 'drop-zone' );

// sample counts are measured asynchronously, so the average is kept for the pause check
let averageSamples = 0;

const orthoWidth = 2;

const _forward = new Vector3();

init();

/**
 * Returns required GPU limits according to DEVICE_LIMITS_REQUESTED.
 *
 * Only limits explicitly listed in DEVICE_LIMITS_REQUESTED will be requested.
 * This avoids requesting all adapter limits and improves compatibility.
 *
 * Note: Limits should be set based on the specific requirements of the application.
 * ensuring broader device compatibility and optimal resource usage.
 *
 * @param {GPUAdapter} adapter
 * @returns {Record<string, number>}
 */
function getRequiredDeviceLimits( adapter ) {

	const limits = {};

	for ( const limit of DEVICE_LIMITS_REQUESTED ) {

		const value = adapter.limits[ limit ];

		if ( typeof value === 'number' && Number.isFinite( value ) ) {

			limits[ limit ] = value;

		}

	}

	return limits;

}

async function init() {

	models = { ...MODEL_LIST };

	loader = new LoaderElement();
	loader.attach( document.body );
	loader.setDescription( DESCRIPTION );

	// adapter limits
	const adapter = await navigator.gpu?.requestAdapter();
	const requiredLimits = getRequiredDeviceLimits( adapter );

	// ltc textures so rect area lights rasterize correctly in the preview
	RectAreaLightTexturesLib.init();
	RectAreaLightNode.setLTC( RectAreaLightTexturesLib );

	// renderer
	renderer = new WebGPURenderer( { antialias: true, requiredLimits } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.setMultipleImportanceSampling( params.multipleImportanceSampling );

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	// physical rather than perspective so models can bring a depth of field with them
	perspectiveCamera = new PhysicalCamera( DEFAULT_FOV, aspect, 0.025, 500 );
	perspectiveCamera.bokehSize = DEFAULT_BOKEH_SIZE;
	perspectiveCamera.focusDistance = 1;

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );

	// background map
	gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( 0x111111 );
	gradientMap.bottomColor.set( 0x000000 );
	gradientMap.update();

	// controls
	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();

	} );
	resetCamera();

	// scene
	scene = new Scene();
	scene.background = gradientMap;

	const floorTex = generateRadialFloorTexture( 2048 );
	floorPlane = new Mesh(
		new PlaneGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0x111111,
			roughness: 0.1,
			metalness: 0.0,
			side: DoubleSide,
		} )
	);
	floorPlane.scale.setScalar( 5 );
	floorPlane.rotation.x = - Math.PI / 2;
	scene.add( floorPlane );

	// a two tier cylinder for the model to sit on, with the top surface at the model's base
	pedestalMaterial = new MeshStandardMaterial( { color: 0x1c1c1c, roughness: 0.35, metalness: 0 } );
	pedestal = new Group();
	const tiers = [ { radius: 0.9, height: 0.05 }, { radius: 0.92, height: 0.05 } ];
	tiers.forEach( ( { radius, height }, i ) => {

		// each tier sinks halfway into the one above it so the pair reads as a single piece with a
		// ridge running around it rather than two stacked discs
		const tier = new Mesh( createPedestalGeometry( radius, height ), pedestalMaterial );
		tier.position.y = - height * ( 0.5 + i * 0.2 );
		pedestal.add( tier );

	} );
	scene.add( pedestal );

	// oriented once per model load, see alignBackdropToCamera
	backdrop = new Backdrop();
	scene.add( backdrop );

	// one group per lighting rig
	lightRigs = new Group();
	for ( const name in LIGHT_RIGS ) {

		const rig = new Group();
		rig.name = name;
		LIGHT_RIGS[ name ].forEach( ( { size, position, rotation, intensity, color } ) => {

			const [ width, height ] = Array.isArray( size ) ? size : [ size, size ];
			const light = new RectAreaLight( color, intensity, width, height );
			light.position.set( ...position );

			// lights aim at the model unless the rig fixes their orientation
			if ( rotation ) light.rotation.set( ...rotation );
			else light.lookAt( 0, 0.35, 0 );

			rig.add( light );

			if ( SHOW_LIGHT_HELPERS ) {

				light.add( new RectAreaLightHelper( light ) );

			}

		} );

		lightRigs.add( rig );

	}

	scene.add( lightRigs );

	stats = new Stats();
	document.body.appendChild( stats.dom );

	updateCameraProjection( params.cameraProjection );
	updateStage();
	updateLighting();
	onModelChange();
	updateEnvMap();
	onResize();

	animate();

	window.addEventListener( 'resize', onResize );
	window.addEventListener( 'popstate', onModelChange );
	window.addEventListener( 'drop', onDrop );
	window.addEventListener( 'dragover', e => {

		e.preventDefault();
		dropZone.classList.remove( 'hidden' );

	} );
	window.addEventListener( 'dragleave', e => {

		if ( e.relatedTarget === null || e.relatedTarget === document.documentElement ) {

			dropZone.classList.add( 'hidden' );

		}

	} );

}

function animate() {

	requestAnimationFrame( animate );

	stats.update();

	if ( ! model ) {

		return;

	}

	if ( params.enable ) {

		if ( ! params.pause || averageSamples < 1 ) {

			pathTracer.renderSample();

		}

	} else {

		renderer.render( scene, activeCamera );

	}

	pathTracer.getSampleCountsAsync().then( counts => {

		averageSamples = counts.avg;
		loader.setSamples( counts );

	} );

}

// A rounded box scaled into a disc. The corner radius is half the box width so the x / z profile
// closes into a circle, and scaling y shrinks that same radius into a small bevel around the rim.
function createPedestalGeometry( radius, height, bevel = 0.01, segments = 32 ) {

	const geometry = new RoundedBoxGeometry( 2, height / bevel, 2, segments, 1 );
	geometry.scale( radius, bevel, radius );

	return geometry;

}

// the scenery objects are all present in the scene and swapped by toggling visibility, which only
// requires the transforms to be re-uploaded rather than a full scene rebuild
function updateStage() {

	floorPlane.visible = params.stage === 'floor';
	pedestal.visible = params.stage === 'pedestal';
	backdrop.visible = params.stage === 'backdrop';

	pathTracer.updateTransforms();

}

function updateLighting() {

	lightRigs.children.forEach( rig => rig.visible = rig.name === params.lighting );

	pathTracer.updateLights();

}

// Orients the backdrop and light rigs relative to the camera. Only run when the model changes so
// they stay put while orbiting.
function alignBackdropToCamera() {

	const dx = activeCamera.position.x;
	const dz = activeCamera.position.z;
	const angle = Math.atan2( dx, dz );

	backdrop.rotation.y = angle;
	backdrop.position.x = - Math.sin( angle ) * BACKDROP_DISTANCE;
	backdrop.position.z = - Math.cos( angle ) * BACKDROP_DISTANCE;

	lightRigs.rotation.y = angle;

}

function onParamsChange() {

	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	const transparent = params.background === 'transparent';
	if ( transparent ) {

		scene.background = null;
		renderer.setClearAlpha( 0 );

	} else {

		const dark = params.background === 'black';
		gradientMap.topColor.set( dark ? 0x111111 : 0xe0e0e0 );
		gradientMap.bottomColor.set( dark ? 0x000000 : 0xc4c4c4 );
		gradientMap.update();

		scene.background = gradientMap;
		renderer.setClearAlpha( 1 );

	}

	const light = params.background === 'white';
	floorPlane.material.color.set( light ? 0xd2d2d2 : 0x111111 );
	pedestalMaterial.color.set( light ? 0xdcdcdc : 0x1c1c1c );
	backdrop.material.color.set( light ? 0xc6c6c6 : 0x161616 );
	backdrop.material.roughness = light ? 0.2 : 0.6;

	document.body.classList.toggle( 'checkerboard', transparent );
	document.body.classList.toggle( 'light-background', light );

	pathTracer.updateMaterials();
	pathTracer.updateEnvironment();
	pathTracer.setMultipleImportanceSampling( params.multipleImportanceSampling );

}

function onModelChange() {

	const value = new URLSearchParams( window.location.search ).get( 'model' ) || '';

	if ( /^https?:\/\//.test( value ) ) {

		customModel = { url: value };
		params.model = '';

	} else if ( value in models ) {

		customModel = null;
		params.model = value;

	} else {

		customModel = null;
		params.model = Object.keys( models )[ 0 ];

	}

	updateModel();

}

// loads dropped files without adding them to the model list
async function onDrop( e ) {

	e.preventDefault();
	dropZone.classList.add( 'hidden' );

	const files = [ ...e.dataTransfer.files ];
	const rootFile = files.find( file => MODEL_FILE_REGEX.test( file.name ) );
	if ( ! rootFile ) {

		return;

	}

	// the root file is loaded by name so the extension is still available to pick a loader
	const fileMap = new Map();
	files.forEach( file => fileMap.set( file.name, URL.createObjectURL( file ) ) );

	customModel = { url: rootFile.name, fileMap };
	params.model = '';

	await updateModel();

	// the files are only needed while loading
	fileMap.forEach( url => URL.revokeObjectURL( url ) );

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const aspect = w / h;
	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function buildGui() {

	gui = new GUI();

	// custom models are shown as an empty entry since they are not in the list
	const modelOptions = customModel ? [ '', ...Object.keys( models ) ] : Object.keys( models );
	gui.add( params, 'model', modelOptions ).onChange( v => {

		const url = new URL( window.location );
		url.searchParams.set( 'model', v );
		window.history.pushState( {}, '', url );
		onModelChange();

	} );

	const pathTracingFolder = gui.addFolder( 'Path Tracer' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'bounces', 1, 50, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'renderScale', 0.1, 1.0, 0.01 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'tiles', 1, 10, 1 ).onChange( v => {

		pathTracer.tiles.set( v, v );

	} );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic' ] ).onChange( v => {

		updateCameraProjection( v );

	} );
	pathTracingFolder.open();

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( params, 'bokehSize', 0, 100, 0.5 ).onChange( updateDepthOfField );
	cameraFolder.add( params, 'focusDistance', 0.05, 10, 0.01 ).onChange( updateDepthOfField );

	const backdropFolder = gui.addFolder( 'Backdrop' );
	backdropFolder.add( params, 'envMap', envMaps ).name( 'environment' ).onChange( updateEnvMap );
	backdropFolder.add( params, 'stage', [ 'floor', 'pedestal', 'backdrop', 'none' ] ).name( 'stage' ).onChange( updateStage );
	backdropFolder.add( params, 'background', [ 'black', 'white', 'transparent' ] ).name( 'background' ).onChange( onParamsChange );
	backdropFolder.add( params, 'lighting', [ 'none', ...Object.keys( LIGHT_RIGS ) ] ).name( 'lighting' ).onChange( updateLighting );
	backdropFolder.open();

}

function updateEnvMap() {

	if ( params.envMap === NO_ENVIRONMENT ) {

		scene.environment?.dispose();
		scene.environment = null;
		pathTracer.updateEnvironment();
		onParamsChange();
		return;

	}

	const url = params.envMap;
	new HDRLoader()
		.load( url, texture => {

			// a different environment - or none - was selected while this one downloaded
			if ( params.envMap !== url ) {

				texture.dispose();
				return;

			}

			if ( scene.environment ) {

				scene.environment.dispose();

			}

			texture.mapping = EquirectangularReflectionMapping;
			scene.environment = texture;
			pathTracer.updateEnvironment();
			onParamsChange();

		} );

}

// models are normalized to a unit sphere at the origin so the framing is the same for all of them
function resetCamera() {

	perspectiveCamera.position.set( - 1, 0.35, 1 ).multiplyScalar( 1.7 );
	perspectiveCamera.fov = DEFAULT_FOV;
	perspectiveCamera.updateProjectionMatrix();
	orthoCamera.position.set( - 1, 0.25, 1 );

	controls.target.set( 0, 0, 0 );
	controls.update();

}

// frame the view from the camera embedded in the model, keeping the screen aspect ratio
function useModelCamera( sceneCamera ) {

	scene.updateMatrixWorld( true );

	sceneCamera.getWorldPosition( perspectiveCamera.position );
	orthoCamera.position.copy( perspectiveCamera.position );

	perspectiveCamera.fov = sceneCamera.fov;
	perspectiveCamera.updateProjectionMatrix();

	// adjust the controls target point
	const forward = sceneCamera.getWorldDirection( _forward );
	const distance = Math.max( - forward.dot( perspectiveCamera.position ), 0.1 );
	controls.target.copy( perspectiveCamera.position ).addScaledVector( forward, distance );

	controls.update();

}

// depth of field is described per model since the focus distance only means anything relative to
// the normalized model scale
function updateDepthOfField() {

	perspectiveCamera.bokehSize = params.bokehSize;
	perspectiveCamera.focusDistance = params.focusDistance;
	pathTracer.updateCamera();

}

function updateCameraProjection( cameraProjection ) {

	// sync position
	if ( activeCamera ) {

		perspectiveCamera.position.copy( activeCamera.position );
		orthoCamera.position.copy( activeCamera.position );

	}

	// set active camera
	if ( cameraProjection === 'Perspective' ) {

		activeCamera = perspectiveCamera;

	} else {

		activeCamera = orthoCamera;

	}

	controls.object = activeCamera;
	controls.update();

	pathTracer.setCamera( activeCamera );

}

async function updateModel() {

	if ( gui ) {

		gui.destroy();
		gui = null;

	}

	const modelInfo = customModel || models[ params.model ];

	// hide the canvas and the transparency checkerboard while loading
	document.body.classList.remove( 'checkerboard' );
	renderer.domElement.style.visibility = 'hidden';
	loader.setPercentage( 0 );

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
		model = null;

	}

	try {

		model = await loadModel( modelInfo.url, v => {

			loader.setPercentage( 0.5 * v );

		}, modelInfo.fileMap );

	} catch ( err ) {

		loader.setCredits( 'Failed to load model:' + err.message );
		loader.setPercentage( 1 );

	}

	model.traverse( c => {

		if ( c.material ) {

			// set the thickness so we render the material as a volumetric object
			c.material.thickness = 1.0;

		}

	} );

	if ( modelInfo.postProcess ) {

		modelInfo.postProcess( model );

	}

	// lights that came out of the model rather than a rig need their own helpers
	if ( SHOW_LIGHT_HELPERS ) {

		model.traverse( c => {

			if ( c.isRectAreaLight ) {

				c.add( new RectAreaLightHelper( c ) );

			}

		} );

	}

	// rotate model after so it doesn't affect the bounding sphere scale
	if ( modelInfo.rotation ) {

		model.rotation.set( ...modelInfo.rotation );

	}

	// center the model
	const box = new Box3();
	box.setFromObject( model );
	model.position
		.addScaledVector( box.min, - 0.5 )
		.addScaledVector( box.max, - 0.5 );

	const sphere = new Sphere();
	box.getBoundingSphere( sphere );

	const scale = 1 / sphere.radius;
	model.scale.setScalar( scale );
	model.position.multiplyScalar( scale );
	box.setFromObject( model, true );

	// attenuation and light dimensions are measured in world units and ignore the object
	// hierarchy scale, so they must be scaled with the model
	const scaledMaterials = new Set();
	model.traverse( c => {

		if ( c.material && ! scaledMaterials.has( c.material ) ) {

			scaledMaterials.add( c.material );
			c.material.attenuationDistance *= scale;

		}

		if ( c.isRectAreaLight ) {

			c.width *= scale;
			c.height *= scale;

		}

	} );

	// rest the scenery on the bottom of the model
	floorPlane.position.y = box.min.y - 1e-3;
	pedestal.position.y = box.min.y - 1e-3;
	backdrop.position.y = box.min.y - 1e-3;

	scene.add( model );

	// view the scene through the camera embedded in the model when one is present
	let sceneCamera = null;
	model.traverse( c => {

		if ( ! sceneCamera && c.isPerspectiveCamera ) sceneCamera = c;

	} );

	if ( sceneCamera ) {

		useModelCamera( sceneCamera );

	} else {

		resetCamera();

	}

	alignBackdropToCamera();

	pathTracer.setScene( scene, activeCamera );

	loader.setPercentage( 1 );
	loader.setCredits( modelInfo.credit || '' );

	// models that carry their own lighting can override the scene defaults, naming an environment
	// from the list above rather than restating its url
	params.envMap = envMaps[ modelInfo.envMap ] ?? modelInfo.envMap ?? envMaps[ 'Aristea Wreck Puresky' ];
	params.lighting = modelInfo.lighting ?? 'none';
	params.stage = modelInfo.stage ?? 'floor';
	params.background = modelInfo.background ?? 'white';

	params.bokehSize = modelInfo.bokehSize ?? DEFAULT_BOKEH_SIZE;
	params.focusDistance = modelInfo.focusDistance ?? 1;

	updateStage();
	updateLighting();
	updateEnvMap();
	updateDepthOfField();

	buildGui();
	onParamsChange();

	renderer.domElement.style.visibility = 'visible';

}

async function loadModel( url, onProgress, fileMap = null ) {

	// TODO: clean up
	const manager = new LoadingManager();

	// dropped files are loaded by name and resolved to their blob urls here so relative
	// references between them still work
	if ( fileMap ) {

		manager.setURLModifier( url => fileMap.get( url.split( '/' ).pop() ) || url );

	}

	if ( /dae$/i.test( url ) ) {

		const complete = new Promise( resolve => manager.onLoad = resolve );
		const res = await new ColladaLoader( manager ).loadAsync( url, progress => {

			if ( progress.total !== 0 && progress.total >= progress.loaded ) {

				onProgress( progress.loaded / progress.total );

			}

		} );
		await complete;

		res.scene.scale.setScalar( 1 );
		res.scene.traverse( c => {

			const { material } = c;
			if ( material && material.isMeshPhongMaterial ) {

				c.material = new MeshStandardMaterial( {

					color: material.color,
					roughness: material.roughness || 0,
					metalness: material.metalness || 0,
					map: material.map || null,

				} );

			}

		} );

		return res.scene;

	} else if ( /(gltf|glb)$/i.test( url ) ) {

		const dracoLoader = new DRACOLoader().setDecoderPath( DRACO_DECODER_PATH );
		const ktx2Loader = new KTX2Loader().setTranscoderPath( KTX2_TRANSCODER_PATH ).detectSupport( renderer );

		const complete = new Promise( resolve => manager.onLoad = resolve );
		const gltf = await new GLTFLoader( manager )
			.setMeshoptDecoder( MeshoptDecoder )
			.setDRACOLoader( dracoLoader )
			.setKTX2Loader( ktx2Loader )
			.loadAsync( url, progress => {

				if ( progress.total !== 0 && progress.total >= progress.loaded ) {

					onProgress( progress.loaded / progress.total );

				}

			} );
		await complete;

		return gltf.scene;

	} else if ( /mpd$/i.test( url ) ) {

		manager.onProgress = ( url, loaded, total ) => {

			onProgress( loaded / total );

		};

		const complete = new Promise( resolve => manager.onLoad = resolve );
		const ldrawLoader = new LDrawLoader( manager );
		ldrawLoader.setConditionalLineMaterial( LDrawConditionalLineMaterial );
		await ldrawLoader.preloadMaterials( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr' );
		const result = await ldrawLoader
			.setPartsLibraryPath( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/' )
			.loadAsync( url );
		await complete;

		const model = LDrawUtils.mergeObject( result );
		model.rotation.set( Math.PI, 0, 0 );

		const toRemove = [];
		model.traverse( c => {

			if ( c.isLineSegments ) {

				toRemove.push( c );

			}

			if ( c.isMesh ) {

				c.material.roughness *= 0.25;

			}

		} );

		toRemove.forEach( c => {

			c.parent.remove( c );

		} );

		return model;

	}

}
