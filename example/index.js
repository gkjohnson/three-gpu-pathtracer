import {
	ACESFilmicToneMapping,
	NoToneMapping,
	Box3,
	LoadingManager,
	Sphere,
	Color,
	DoubleSide,
	Mesh,
	MeshStandardMaterial,
	PlaneBufferGeometry,
	Group,
	MeshPhysicalMaterial,
	WebGLRenderer,
	Scene,
	PerspectiveCamera,
	OrthographicCamera,
	MeshBasicMaterial,
	sRGBEncoding,
	CustomBlending,
	Matrix4
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { PhysicalPathTracingMaterial, PathTracingRenderer, MaterialReducer, BlurredEnvMapGenerator } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TemporalResolve } from '../src/temporal-resolve/TemporalResolve.js';

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

	temporalResolve: true,
	temporalResolveMix: 0.9,
	clampRadius: 1,
	newSamplesSmoothing: 0.675,
	newSamplesCorrection: 1,
	weightTransform: 0,

	model: initialModel,

	envMap: envMaps[ 'Royal Esplanade' ],

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
	bounces: 3,
	filterGlossyFactor: 0.5,
	pause: false,

	floorColor: '#080808',
	floorOpacity: 1.0,
	floorRoughness: 0.1,
	floorMetalness: 0.0

};

let creditEl, loadingEl, samplesEl;
let floorPlane, gui, stats, sceneInfo;
let renderer, orthoCamera, perspectiveCamera, activeCamera;
let ptRenderer, fsQuad, controls, scene, temporalResolve;
let envMap, envMapGenerator;
let loadingModel = false;
let delaySamples = 0;

const orthoWidth = 2;

init();

async function init() {

	creditEl = document.getElementById( 'credits' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 60, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 1, 0.25, 1 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.set( - 1, 0.25, 1 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.material.setDefine( 'FEATURE_GRADIENT_BG', 1 );
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.material.bgGradientTop.set( params.bgGradientTop );
	ptRenderer.material.bgGradientBottom.set( params.bgGradientBottom );

	temporalResolve = new TemporalResolve( ptRenderer, scene, activeCamera );
	temporalResolve.temporalResolveMix = 0.9;
	temporalResolve.clampRadius = 1;
	temporalResolve.newSamplesSmoothing = 0.5;
	temporalResolve.newSamplesCorrection = 0.75;
	temporalResolve.weightTransform = 0;

	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', resetRenderer );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const floorTex = generateRadialFloorTexture( 2048 );
	floorPlane = new Mesh(
		new PlaneBufferGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0x080808,
			roughness: 0.1,
			metalness: 0.0
		} )
	);
	floorPlane.scale.setScalar( 3 );
	floorPlane.rotation.x = - Math.PI / 2;

	stats = new Stats();
	document.body.appendChild( stats.dom );
	renderer.physicallyCorrectLights = true;
	renderer.toneMapping = ACESFilmicToneMapping;
	ptRenderer.material.setDefine( 'FEATURE_GRADIENT_BG', 1 );
	scene.background = new Color( 0x060606 );
	ptRenderer.tiles.set( params.tilesX, params.tilesY );

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

	floorPlane.material.color.set( params.floorColor );
	floorPlane.material.roughness = params.floorRoughness;
	floorPlane.material.metalness = params.floorMetalness;
	floorPlane.material.opacity = params.floorOpacity;
	ptRenderer.material.bgGradientTop.set( params.bgGradientTop );
	ptRenderer.material.bgGradientBottom.set( params.bgGradientBottom );

	if ( ptRenderer.samples < 1.0 || ! params.enable ) {

		renderer.render( scene, activeCamera );

	}

	if ( params.enable && delaySamples === 0 ) {

		const samples = Math.floor( ptRenderer.samples );
		samplesEl.innerText = `samples: ${ samples }`;

		ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
		ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
		ptRenderer.material.environmentIntensity = params.environmentIntensity;
		ptRenderer.material.bounces = params.bounces;
		ptRenderer.material.physicalCamera.updateFrom( activeCamera );

		activeCamera.updateMatrixWorld();

		if ( ! params.pause || ptRenderer.samples < 1 ) {

			for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

				ptRenderer.update();

			}

		}

		renderer.autoClear = false;
		if ( params.temporalResolve ) {

			temporalResolve.update();
			fsQuad.material.map = temporalResolve.target.texture;

		} else {

			fsQuad.material.map = ptRenderer.target.texture;

		}

		fsQuad.render( renderer );
		renderer.autoClear = true;

	} else if ( delaySamples > 0 ) {

		delaySamples --;

	}

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}

function resetRenderer() {

	if ( ! params.temporalResolve && params.tilesX * params.tilesY !== 1.0 ) {

		delaySamples = 1;

	}

	ptRenderer.reset();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const scale = params.resolutionScale;
	const dpr = window.devicePixelRatio;

	ptRenderer.setSize( w * scale * dpr, h * scale * dpr );
	ptRenderer.reset();

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio * scale );

	const aspect = w / h;
	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

}

function buildGui() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	gui.add( params, 'model', Object.keys( models ) ).onChange( updateModel );

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( v => {

		ptRenderer.material.setDefine( 'FEATURE_MIS', Number( v ) );
		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( v => {

		renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );

	const trFolder = gui.addFolder( 'Temporal Resolve' );
	trFolder.add( params, 'temporalResolve' );
	trFolder
		.add( params, 'temporalResolveMix', 0, 1, 0.025 )
		.onChange( ( value ) => ( temporalResolve.temporalResolveMix = value ) );
	trFolder
		.add( params, 'clampRadius', 1, 8, 1 )
		.onChange( ( value ) => ( temporalResolve.clampRadius = value ) );
	trFolder
		.add( params, 'newSamplesSmoothing', 0, 1, 0.025 )
		.onChange( ( value ) => ( temporalResolve.newSamplesSmoothing = value ) );
	trFolder
		.add( params, 'newSamplesCorrection', 0, 1, 0.025 )
		.onChange( ( value ) => ( temporalResolve.newSamplesCorrection = value ) );
	trFolder
		.add( params, 'weightTransform', 0, 0.5, 0.025 )
		.onChange( ( value ) => ( temporalResolve.weightTransform = value ) );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( () => {

		onResize();

	} );
	resolutionFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	resolutionFolder.add( params, 'tilesX', 1, 10, 1 ).onChange( v => {

		ptRenderer.tiles.x = v;

	} );
	resolutionFolder.add( params, 'tilesY', 1, 10, 1 ).onChange( v => {

		ptRenderer.tiles.y = v;

	} );
	resolutionFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic' ] ).onChange( v => {

		updateCamera( v );

	} );
	resolutionFolder.open();

	const environmentFolder = gui.addFolder( 'environment' );
	environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );
	environmentFolder.add( params, 'environmentBlur', 0.0, 1.0 ).onChange( () => {

		updateEnvBlur();
		ptRenderer.reset();

	} ).name( 'env map blur' );
	environmentFolder.add( params, 'environmentIntensity', 0.0, 10.0 ).onChange( () => {

		ptRenderer.reset();

	} ).name( 'intensity' );
	environmentFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( v => {

		ptRenderer.material.environmentRotation.setFromMatrix4( new Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	environmentFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'backgroundType', [ 'Environment', 'Gradient' ] ).onChange( v => {

		ptRenderer.material.setDefine( 'FEATURE_GRADIENT_BG', Number( v === 'Gradient' ) );
		if ( v === 'Gradient' ) {

			scene.background = new Color( 0x060606 );

		} else {

			scene.background = scene.environment;

		}

		ptRenderer.reset();

	} );
	backgroundFolder.addColor( params, 'bgGradientTop' ).onChange( () => {

		ptRenderer.reset();

	} );
	backgroundFolder.addColor( params, 'bgGradientBottom' ).onChange( () => {

		ptRenderer.reset();

	} );
	backgroundFolder.add( params, 'backgroundAlpha', 0, 1 ).onChange( v => {

		ptRenderer.material.backgroundAlpha = v;
		ptRenderer.reset();

	} );
	backgroundFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) document.body.classList.add( 'checkerboard' );
		else document.body.classList.remove( 'checkerboard' );

	} );

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.addColor( params, 'floorColor' ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorRoughness', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorMetalness', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorOpacity', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
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
			ptRenderer.reset();

		} );

}

function updateEnvBlur() {

	const blurredEnvMap = envMapGenerator.generate( envMap, params.environmentBlur );
	ptRenderer.material.envMapInfo.updateFrom( blurredEnvMap );

	scene.environment = blurredEnvMap;
	if ( params.backgroundType !== 'Gradient' ) {

		scene.background = blurredEnvMap;

	}

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
	ptRenderer.camera = activeCamera;

	controls.update();

	resetRenderer();

}

function convertOpacityToTransmission( model ) {

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
	renderer.domElement.style.visibility = 'hidden';
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

	if ( sceneInfo ) {

		scene.remove( sceneInfo.scene );

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

			convertOpacityToTransmission( model );

		}

		model.traverse( c => {

			if ( c.material ) {

				// set the thickness so we render the material as a volumetric object
				c.material.thickness = 1.0;
				c.material.side = DoubleSide;

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

		const generator = new PathTracingSceneWorker();
		const result = await generator.generate( group, { onProgress: v => {

			const percent = Math.floor( 100 * v );
			loadingEl.innerText = `Building BVH : ${ percent }%`;

		} } );

		sceneInfo = result;
		scene.add( sceneInfo.scene );

		const { bvh, textures, materials } = result;
		const geometry = bvh.geometry;
		const material = ptRenderer.material;

		material.bvh.updateFrom( bvh );
		material.normalAttribute.updateFrom( geometry.attributes.normal );
		material.tangentAttribute.updateFrom( geometry.attributes.tangent );
		material.uvAttribute.updateFrom( geometry.attributes.uv );
		material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
		material.colorAttribute.updateFrom( geometry.attributes.color );
		material.textures.setTextures( renderer, 2048, 2048, textures );
		material.materials.updateFrom( materials, textures );

		generator.dispose();

		loadingEl.style.visibility = 'hidden';

		creditEl.innerHTML = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		params.bounces = modelInfo.bounces || 3;
		params.floorColor = modelInfo.floorColor || '#080808';
		params.floorRoughness = modelInfo.floorRoughness || 1.0;
		params.floorMetalness = modelInfo.floorMetalness || 0.0;
		params.bgGradientTop = modelInfo.gradientTop || '#111111';
		params.bgGradientBottom = modelInfo.gradientBot || '#000000';

		buildGui();

		loadingModel = false;
		renderer.domElement.style.visibility = 'visible';
		if ( params.checkerboardTransparency ) {

			document.body.classList.add( 'checkerboard' );

		}

		ptRenderer.reset();

	};

	const url = modelInfo.url;
	if ( /(gltf|glb)$/i.test( url ) ) {

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

		manager.onProgress = ( url, loaded, total ) => {

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
					model.traverse( c => {

						if ( c.isLineSegments ) {

							c.visible = false;

						}

						if ( c.isMesh ) {

							c.material.roughness *= 0.25;

						}

					} );
					onFinish();

				},
			);

	}

}
