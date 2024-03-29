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
	Group,
	MeshPhysicalMaterial,
	Scene,
	PerspectiveCamera,
	OrthographicCamera,
	WebGLRenderer,
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
import { MaterialReducer, BlurredEnvMapGenerator, GradientEquirectTexture, WebGLPathTracer } from '../src/index.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

let initialModel = Object.keys( models )[ 0 ];
if ( window.location.hash ) {

	const modelName = window.location.hash.substring( 1 ).replaceAll( '%20', ' ' );
	if ( modelName in models ) {

		initialModel = modelName;

	}

}

const params = {

	multipleImportanceSampling: true,
	acesToneMapping: true,
	resolutionScale: 1 / window.devicePixelRatio,
	tilesX: 2,
	tilesY: 2,
	samplesPerFrame: 1,

	model: initialModel,

	envMap: envMaps[ 'Aristea Wreck Puresky' ],

	gradientTop: '#bfd8ff',
	gradientBottom: '#ffffff',

	environmentIntensity: 1.0,
	environmentBlur: 0.0,
	environmentRotation: 0,

	cameraProjection: 'Perspective',

	backgroundType: 'Gradient',
	bgGradientTop: '#111111',
	bgGradientBottom: '#000000',
	backgroundAlpha: 1.0,
	checkerboardTransparency: true,

	enable: true,
	bounces: 5,
	filterGlossyFactor: 0.5,
	pause: false,

	floorColor: '#111111',
	floorOpacity: 1.0,
	floorRoughness: 0.2,
	floorMetalness: 0.2,

};

let creditEl, loadingEl, samplesEl;
let floorPlane, gui, stats;
let pathTracer, renderer, orthoCamera, perspectiveCamera, activeCamera;
let controls, scene;
let envMap, envMapGenerator, backgroundMap;
let loadingModel = false;
let delaySamples = 0;

const orthoWidth = 2;

init();

async function init() {

	creditEl = document.getElementById( 'credits' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	renderer = new WebGLRenderer( { antialias: true } );
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.toneMapping = ACESFilmicToneMapping;
	pathTracer.physicallyCorrectLights = true;
	pathTracer.tiles.set( params.tilesX, params.tilesY );
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.transmissiveBounces = 10;
	document.body.appendChild( pathTracer.domElement );

	scene = new Scene();

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 60, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 1, 0.25, 1 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.set( - 1, 0.25, 1 );

	backgroundMap = new GradientEquirectTexture();
	backgroundMap.topColor.set( params.bgGradientTop );
	backgroundMap.bottomColor.set( params.bgGradientBottom );
	backgroundMap.update();

	controls = new OrbitControls( perspectiveCamera, pathTracer.domElement );
	controls.addEventListener( 'change', () => {

		if ( params.tilesX * params.tilesY !== 1.0 ) {

			delaySamples = 5;

		}

		resetRenderer();

	} );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

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

	stats = new Stats();
	document.body.appendChild( stats.dom );
	scene.background = backgroundMap;

	updateCamera( params.cameraProjection );
	updateModel();
	updateEnvMap();
	onResize();

	animate();

	window.addEventListener( 'resize', onResize );

}

function animate() {

	requestAnimationFrame( animate );

	stats.update();

	if ( loadingModel ) {

		return;

	}

	if ( params.enable && delaySamples === 0 ) {

		activeCamera.updateMatrixWorld();

		if ( ! params.pause || pathTracer.samples < 1 ) {

			pathTracer.renderSample();

		}

	} else {

		delaySamples --;
		renderer.render( scene, activeCamera );

	}

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}

function resetRenderer() {

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.bounces = params.bounces;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.renderScale = params.resolutionScale;

	floorPlane.material.color.set( params.floorColor );
	floorPlane.material.roughness = params.floorRoughness;
	floorPlane.material.metalness = params.floorMetalness;
	floorPlane.material.opacity = params.floorOpacity;

	// TODO: this cannot set the background alpha of a background texture
	// renderer.setClearColor( params.backgroundAlpha );

	scene.environmentIntensity = params.environmentIntensity;
	scene.environmentRotation.y = params.environmentRotation;
	if ( params.backgroundType === 'Gradient' ) {

		backgroundMap.topColor.set( params.bgGradientTop );
		backgroundMap.bottomColor.set( params.bgGradientBottom );
		backgroundMap.update();

		scene.background = backgroundMap;
		scene.backgroundIntensity = 1;
		scene.environmentRotation.y = 0;

	} else {

		scene.background = scene.environment;
		scene.backgroundIntensity = params.environmentIntensity;
		scene.backgroundRotation.y = params.environmentRotation;

	}

	pathTracer.updateScene( activeCamera, scene );

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	pathTracer.setSize( w, h );
	pathTracer.setPixelRatio( dpr );

	const aspect = w / h;
	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

	resetRenderer();

}

function buildGui() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	gui.add( params, 'model', Object.keys( models ).sort() ).onChange( updateModel );

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( resetRenderer );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( v => {

		pathTracer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( resetRenderer );
	pathTracingFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( resetRenderer );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( () => {

		onResize();

	} );
	resolutionFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	resolutionFolder.add( params, 'tilesX', 1, 10, 1 ).onChange( v => {

		pathTracer.tiles.x = v;

	} );
	resolutionFolder.add( params, 'tilesY', 1, 10, 1 ).onChange( v => {

		pathTracer.tiles.y = v;

	} );
	resolutionFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic' ] ).onChange( v => {

		updateCamera( v );

	} );
	resolutionFolder.open();

	const environmentFolder = gui.addFolder( 'environment' );
	environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );
	environmentFolder.add( params, 'environmentBlur', 0.0, 1.0 ).onChange( () => {

		updateEnvBlur();

	} ).name( 'env map blur' );
	environmentFolder.add( params, 'environmentIntensity', 0.0, 10.0 ).onChange( resetRenderer ).name( 'intensity' );
	environmentFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( resetRenderer );
	environmentFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'backgroundType', [ 'Environment', 'Gradient' ] ).onChange( resetRenderer );
	backgroundFolder.addColor( params, 'bgGradientTop' ).onChange( resetRenderer );
	backgroundFolder.addColor( params, 'bgGradientBottom' ).onChange( resetRenderer );
	backgroundFolder.add( params, 'backgroundAlpha', 0, 1 ).onChange( resetRenderer );
	backgroundFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) document.body.classList.add( 'checkerboard' );
		else document.body.classList.remove( 'checkerboard' );

	} );

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.addColor( params, 'floorColor' ).onChange( resetRenderer );
	floorFolder.add( params, 'floorRoughness', 0, 1 ).onChange( resetRenderer );
	floorFolder.add( params, 'floorMetalness', 0, 1 ).onChange( resetRenderer );
	floorFolder.add( params, 'floorOpacity', 0, 1 ).onChange( resetRenderer );
	floorFolder.close();

}

function updateEnvMap() {

	new RGBELoader()
		.load( params.envMap, texture => {

			if ( scene.environmentMap ) {

				scene.environment.dispose();
				envMap.dispose();

			}

			envMap = texture;
			updateEnvBlur();

		} );

}

function updateEnvBlur() {

	const blurredEnvMap = envMapGenerator.generate( envMap, params.environmentBlur );
	scene.environment = blurredEnvMap;
	resetRenderer();

}

function updateCamera( cameraProjection ) {

	if ( cameraProjection === 'Perspective' ) {

		if ( activeCamera ) {

			perspectiveCamera.position.copy( activeCamera.position );

		}

		activeCamera = perspectiveCamera;

	} else {

		if ( activeCamera ) {

			orthoCamera.position.copy( activeCamera.position );

		}

		activeCamera = orthoCamera;

	}

	controls.object = activeCamera;
	controls.update();

	resetRenderer();

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

	let model;
	const manager = new LoadingManager();
	const modelInfo = models[ params.model ];

	loadingModel = true;
	pathTracer.domElement.style.visibility = 'hidden';
	samplesEl.innerText = '--';
	creditEl.innerText = '--';
	loadingEl.innerText = 'Loading';
	loadingEl.style.visibility = 'visible';

	scene.traverse( c => {

		if ( c.material ) {

			const material = c.material;
			for ( const key in material ) {

				if ( material[ key ] && material[ key ].isTexture ) {

					material[ key ].dispose();

				}

			}

		}

	} );

	if ( scene.children.length ) {

		const children = [ ... scene.children ];
		children.forEach( c => scene.remove( c ) );

	}

	const onFinish = async () => {

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

		model.updateMatrixWorld();

		const group = new Group();
		floorPlane.position.y = box.min.y;
		group.add( model, floorPlane );

		const reducer = new MaterialReducer();
		reducer.process( group );

		scene.add( group );

		loadingEl.style.visibility = 'hidden';

		creditEl.innerHTML = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		params.bounces = modelInfo.bounces || 5;
		params.floorColor = modelInfo.floorColor || '#111111';
		params.floorRoughness = modelInfo.floorRoughness || 0.2;
		params.floorMetalness = modelInfo.floorMetalness || 0.2;
		params.bgGradientTop = modelInfo.gradientTop || '#111111';
		params.bgGradientBottom = modelInfo.gradientBot || '#000000';

		backgroundMap.topColor.set( params.bgGradientTop );
		backgroundMap.bottomColor.set( params.bgGradientBottom );
		backgroundMap.update();

		buildGui();

		loadingModel = false;
		pathTracer.domElement.style.visibility = 'visible';
		if ( params.checkerboardTransparency ) {

			document.body.classList.add( 'checkerboard' );

		}

		resetRenderer();

	};

	const url = modelInfo.url;
	if ( /dae$/i.test( url ) ) {

		manager.onLoad = onFinish;
		new ColladaLoader( manager )
			.load(
				url,
				res => {

					model = res.scene;
					model.scale.setScalar( 1 );

					model.traverse( c => {

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

				},
			);

	} else if ( /(gltf|glb)$/i.test( url ) ) {

		manager.onLoad = onFinish;
		new GLTFLoader( manager )
			.setMeshoptDecoder( MeshoptDecoder )
			.load(
				url,
				gltf => {

					model = gltf.scene;

				},
				progress => {

					if ( progress.total !== 0 && progress.total >= progress.loaded ) {

						const percent = Math.floor( 100 * progress.loaded / progress.total );
						loadingEl.innerText = `Loading : ${ percent }%`;

					}

				},
			);

	} else if ( /mpd$/i.test( url ) ) {

		let failed = false;
		manager.onProgress = ( url, loaded, total ) => {

			if ( failed ) {

				return;

			}

			const percent = Math.floor( 100 * loaded / total );
			loadingEl.innerText = `Loading : ${ percent }%`;

		};

		const loader = new LDrawLoader( manager );
		await loader.preloadMaterials( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr' );
		loader
			.setPartsLibraryPath( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/' )
			.load(
				url,
				result => {

					model = LDrawUtils.mergeObject( result );
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

					onFinish();

				},
				undefined,
				err => {

					failed = true;
					loadingEl.innerText = 'Failed to load model. ' + err.message;

				}

			);

	}

}
