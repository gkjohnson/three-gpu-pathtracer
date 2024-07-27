import {
	ACESFilmicToneMapping,
	NoToneMapping,
	Box3,
	LoadingManager,
	Sphere,
	DoubleSide,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	MeshPhysicalMaterial,
	Scene,
	PerspectiveCamera,
	OrthographicCamera,
	WebGLRenderer,
	EquirectangularReflectionMapping,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { GradientEquirectTexture, WebGLPathTracer } from '../src/index.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';

const envMaps = {
	'Royal Esplanade': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr',
	'Moonless Golf': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/moonless_golf_1k.hdr',
	'Overpass': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
	'Venice Sunset': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr',
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

const models = window.MODEL_LIST || {};

const params = {

	multipleImportanceSampling: true,
	acesToneMapping: true,
	renderScale: 1 / window.devicePixelRatio,
	tiles: 2,

	model: '',

	envMap: envMaps[ 'Aristea Wreck Puresky' ],

	gradientTop: '#bfd8ff',
	gradientBottom: '#ffffff',

	environmentIntensity: 1.0,
	environmentRotation: 0,

	cameraProjection: 'Perspective',

	backgroundType: 'Gradient',
	bgGradientTop: '#111111',
	bgGradientBottom: '#000000',
	backgroundBlur: 0.0,
	transparentBackground: false,
	checkerboardTransparency: true,

	enable: true,
	bounces: 5,
	filterGlossyFactor: 0.5,
	pause: false,

	floorColor: '#111111',
	floorOpacity: 1.0,
	floorRoughness: 0.2,
	floorMetalness: 0.2,

	...getScaledSettings(),

};

let floorPlane, gui, stats;
let pathTracer, renderer, orthoCamera, perspectiveCamera, activeCamera;
let controls, scene, model;
let gradientMap;
let loader;

const orthoWidth = 2;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
	pathTracer.physicallyCorrectLights = true;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.transmissiveBounces = 10;

	// camera
	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 60, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 1, 0.25, 1 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.set( - 1, 0.25, 1 );

	// background map
	gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( params.bgGradientTop );
	gradientMap.bottomColor.set( params.bgGradientBottom );
	gradientMap.update();

	// controls
	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();

	} );

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
	onHashChange();
	updateEnvMap();
	onResize();

	animate();

	window.addEventListener( 'resize', onResize );
	window.addEventListener( 'hashchange', onHashChange );

}

function animate() {

	requestAnimationFrame( animate );

	stats.update();

	if ( ! model ) {

		return;

	}

	if ( params.enable ) {

		if ( ! params.pause || pathTracer.samples < 1 ) {

			pathTracer.renderSample();

		}

	} else {

		renderer.render( scene, activeCamera );

	}

	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}

function onParamsChange() {

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.bounces = params.bounces;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.renderScale = params.renderScale;

	floorPlane.material.color.set( params.floorColor );
	floorPlane.material.roughness = params.floorRoughness;
	floorPlane.material.metalness = params.floorMetalness;
	floorPlane.material.opacity = params.floorOpacity;

	scene.environmentIntensity = params.environmentIntensity;
	scene.environmentRotation.y = params.environmentRotation;
	scene.backgroundBlurriness = params.backgroundBlur;

	if ( params.backgroundType === 'Gradient' ) {

		gradientMap.topColor.set( params.bgGradientTop );
		gradientMap.bottomColor.set( params.bgGradientBottom );
		gradientMap.update();

		scene.background = gradientMap;
		scene.backgroundIntensity = 1;
		scene.environmentRotation.y = 0;

	} else {

		scene.background = scene.environment;
		scene.backgroundIntensity = params.environmentIntensity;
		scene.backgroundRotation.y = params.environmentRotation;

	}

	if ( params.transparentBackground ) {

		scene.background = null;
		renderer.setClearAlpha( 0 );

	}

	pathTracer.updateMaterials();
	pathTracer.updateEnvironment();

}

function onHashChange() {

	let hashModel = '';
	if ( window.location.hash ) {

		const modelName = decodeURI( window.location.hash.substring( 1 ) );
		if ( modelName in models ) {

			hashModel = modelName;

		}

	}

	if ( ! ( hashModel in models ) ) {

		hashModel = Object.keys( models )[ 0 ];

	}

	params.model = hashModel;
	updateModel();

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

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	gui.add( params, 'model', Object.keys( models ).sort() ).onChange( v => {

		window.location.hash = v;

	} );

	const pathTracingFolder = gui.addFolder( 'Path Tracer' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( v => {

		renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( onParamsChange );
	pathTracingFolder.add( params, 'renderScale', 0.1, 1.0, 0.01 ).onChange( () => {

		onParamsChange();

	} );
	pathTracingFolder.add( params, 'tiles', 1, 10, 1 ).onChange( v => {

		pathTracer.tiles.set( v, v );

	} );
	pathTracingFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic' ] ).onChange( v => {

		updateCameraProjection( v );

	} );
	pathTracingFolder.open();

	const environmentFolder = gui.addFolder( 'environment' );
	environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );
	environmentFolder.add( params, 'environmentIntensity', 0.0, 10.0 ).onChange( onParamsChange ).name( 'intensity' );
	environmentFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( onParamsChange );
	environmentFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'backgroundType', [ 'Environment', 'Gradient' ] ).onChange( onParamsChange );
	backgroundFolder.addColor( params, 'bgGradientTop' ).onChange( onParamsChange );
	backgroundFolder.addColor( params, 'bgGradientBottom' ).onChange( onParamsChange );
	backgroundFolder.add( params, 'backgroundBlur', 0, 1 ).onChange( onParamsChange );
	backgroundFolder.add( params, 'transparentBackground', 0, 1 ).onChange( onParamsChange );
	backgroundFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) document.body.classList.add( 'checkerboard' );
		else document.body.classList.remove( 'checkerboard' );

	} );

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.addColor( params, 'floorColor' ).onChange( onParamsChange );
	floorFolder.add( params, 'floorRoughness', 0, 1 ).onChange( onParamsChange );
	floorFolder.add( params, 'floorMetalness', 0, 1 ).onChange( onParamsChange );
	floorFolder.add( params, 'floorOpacity', 0, 1 ).onChange( onParamsChange );
	floorFolder.close();

}

function updateEnvMap() {

	new RGBELoader()
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

function convertOpacityToTransmission( model, ior ) {

	model.traverse( c => {

		if ( c.material ) {

			const material = c.material;
			if ( material.opacity < 0.65 && material.opacity > 0.2 ) {

				const newMaterial = new MeshPhysicalMaterial();
				for ( const key in material ) {

					if ( key in material ) {

						if ( material[ key ] === null ) {

							continue;

						}

						if ( material[ key ].isTexture ) {

							newMaterial[ key ] = material[ key ];

						} else if ( material[ key ].copy && material[ key ].constructor === newMaterial[ key ].constructor ) {

							newMaterial[ key ].copy( material[ key ] );

						} else if ( ( typeof material[ key ] ) === 'number' ) {

							newMaterial[ key ] = material[ key ];

						}

					}

				}

				newMaterial.opacity = 1.0;
				newMaterial.transmission = 1.0;
				newMaterial.ior = ior;

				const hsl = {};
				newMaterial.color.getHSL( hsl );
				hsl.l = Math.max( hsl.l, 0.35 );
				newMaterial.color.setHSL( hsl.h, hsl.s, hsl.l );

				c.material = newMaterial;

			}

		}

	} );

}

async function updateModel() {

	if ( gui ) {

		document.body.classList.remove( 'checkerboard' );
		gui.destroy();
		gui = null;

	}

	const modelInfo = models[ params.model ];

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

		} );

	} catch ( err ) {

		loader.setCredits( 'Failed to load model:' + err.message );
		loader.setPercentage( 1 );

	}

	// update after model load
	// TODO: clean up
	if ( modelInfo.removeEmission ) {

		model.traverse( c => {

			if ( c.material ) {

				c.material.emissiveMap = null;
				c.material.emissiveIntensity = 0;

			}

		} );

	}

	if ( modelInfo.opacityToTransmission ) {

		convertOpacityToTransmission( model, modelInfo.ior || 1.5 );

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

	model.scale.setScalar( 1 / sphere.radius );
	model.position.multiplyScalar( 1 / sphere.radius );
	box.setFromObject( model );
	floorPlane.position.y = box.min.y;

	scene.add( model );

	await pathTracer.setSceneAsync( scene, activeCamera, {

		onProgress: v => loader.setPercentage( 0.5 + 0.5 * v ),

	} );

	loader.setPercentage( 1 );
	loader.setCredits( modelInfo.credit || '' );
	params.bounces = modelInfo.bounces || 5;
	params.floorColor = modelInfo.floorColor || '#111111';
	params.floorRoughness = modelInfo.floorRoughness || 0.2;
	params.floorMetalness = modelInfo.floorMetalness || 0.2;
	params.bgGradientTop = modelInfo.gradientTop || '#111111';
	params.bgGradientBottom = modelInfo.gradientBot || '#000000';

	buildGui();
	onParamsChange();

	renderer.domElement.style.visibility = 'visible';
	if ( params.checkerboardTransparency ) {

		document.body.classList.add( 'checkerboard' );

	}

}

async function loadModel( url, onProgress ) {

	// TODO: clean up
	const manager = new LoadingManager();
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

		const complete = new Promise( resolve => manager.onLoad = resolve );
		const gltf = await new GLTFLoader( manager ).setMeshoptDecoder( MeshoptDecoder ).loadAsync( url, progress => {

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
