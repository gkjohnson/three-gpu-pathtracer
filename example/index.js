import {
	ACESFilmicToneMapping,
	Box3,
	LoadingManager,
	Sphere,
	DoubleSide,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	Scene,
	PerspectiveCamera,
	OrthographicCamera,
	WebGPURenderer,
	EquirectangularReflectionMapping,
} from 'three/webgpu';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
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

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.181.1/examples/jsm/libs/basis/';
const MODEL_FILE_REGEX = /\.(gltf|glb|dae|mpd)$/i;

const envMaps = {
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

	renderScale: 1,
	tiles: 2,

	model: '',

	envMap: envMaps[ 'Aristea Wreck Puresky' ],

	cameraProjection: 'Perspective',

	transparentBackground: false,

	enable: true,
	bounces: 15,
	pause: false,

	...getScaledSettings(),

};

let floorPlane, gui, stats;
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

	// renderer
	renderer = new WebGPURenderer( { antialias: true, requiredLimits } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 60, aspect, 0.025, 500 );

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

	stats = new Stats();
	document.body.appendChild( stats.dom );

	updateCameraProjection( params.cameraProjection );
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

function onParamsChange() {

	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	if ( params.transparentBackground ) {

		scene.background = null;
		renderer.setClearAlpha( 0 );

	} else {

		scene.background = gradientMap;
		renderer.setClearAlpha( 1 );

	}

	document.body.classList.toggle( 'checkerboard', params.transparentBackground );

	pathTracer.updateEnvironment();

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
	pathTracingFolder.add( params, 'transparentBackground' ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'bounces', 1, 50, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'renderScale', 0.1, 1.0, 0.01 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'tiles', 1, 10, 1 ).onChange( v => {

		pathTracer.tiles.set( v, v );

	} );
	pathTracingFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic' ] ).onChange( v => {

		updateCameraProjection( v );

	} );
	pathTracingFolder.open();

	const environmentFolder = gui.addFolder( 'environment' );
	environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );
	environmentFolder.open();

}

function updateEnvMap() {

	new HDRLoader()
		.load( params.envMap, texture => {

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

	perspectiveCamera.position.set( - 1, 0.25, 1 );
	orthoCamera.position.set( - 1, 0.25, 1 );

	controls.target.set( 0, 0, 0 );
	controls.update();

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
	box.setFromObject( model );

	// attenuation is measured in world units so it must be scaled with the model
	model.traverse( c => {

		if ( c.material ) {

			c.material.attenuationDistance *= scale;

		}

	} );

	floorPlane.position.y = box.min.y - 1e-3;

	scene.add( model );

	resetCamera();
	pathTracer.setScene( scene, activeCamera );

	loader.setPercentage( 1 );
	loader.setCredits( modelInfo.credit || '' );

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
