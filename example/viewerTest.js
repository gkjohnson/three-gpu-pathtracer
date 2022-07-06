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
	Matrix4,
	DataTexture,
	RGBAFormat,
	FloatType,
	EquirectangularReflectionMapping,
	MathUtils,
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

const CONFIG_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json';
const BASE_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/';

const params = {

	multipleImportanceSampling: true,
	acesToneMapping: true,
	resolutionScale: 1 / window.devicePixelRatio,
	tilesX: 5,
	tilesY: 5,
	samplesPerFrame: 1,

	model: '',

	gradientTop: '#bfd8ff',
	gradientBottom: '#ffffff',

	environmentIntensity: 3.0,
	environmentBlur: 0.0,
	environmentRotation: 0,

	checkerboardTransparency: true,

	enable: true,
	bounces: 2,
	pause: false,

};

let creditEl, loadingEl, samplesEl, containerEl;
let floorPlane, gui, stats, sceneInfo;
let renderer, orthoCamera, camera;
let ptRenderer, fsQuad, controls, scene;
let envMap, envMapGenerator;
let loadingModel = false;
let delaySamples = 0;
let models;

const orthoWidth = 2;

init();

async function init() {

	creditEl = document.getElementById( 'credits' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );
	containerEl = document.getElementById( 'container' );

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	containerEl.appendChild( renderer.domElement );

	scene = new Scene();

	const aspect = window.innerWidth / window.innerHeight;
	camera = new PerspectiveCamera( 60, aspect, 0.025, 500 );
	camera.position.set( - 1, 0.25, 1 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );

	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', resetRenderer );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	stats = new Stats();
	containerEl.appendChild( stats.dom );
	renderer.physicallyCorrectLights = true;
	renderer.toneMapping = ACESFilmicToneMapping;
	scene.background = new Color( 0x060606 );
	ptRenderer.tiles.set( params.tilesX, params.tilesY );


	const { scenarios } = await ( await fetch( CONFIG_URL ) ).json();

	console.log(scenarios)
	models = {};
	scenarios.forEach( s => {

		models[ s.name ] = s;

	} );

	let initialModel = scenarios[ 0 ].name;
	if ( window.location.hash ) {

		const modelName = window.location.hash.substring( 1 ).replaceAll( '%20', ' ' );
		if ( modelName in models ) {

			initialModel = modelName;

		}

	}

	params.model = initialModel;

	updateModel();

	animate();

}

function animate() {

	requestAnimationFrame( animate );

	stats.update();

	if ( loadingModel ) {

		return;

	}

	if ( ptRenderer.samples < 1.0 || ! params.enable ) {

		renderer.render( scene, camera );

	}

	if ( params.enable && delaySamples === 0 ) {

		const samples = Math.floor( ptRenderer.samples );
		samplesEl.innerText = `samples: ${ samples }`;

		ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
		ptRenderer.material.filterGlossyFactor = 0.5;
		ptRenderer.material.environmentIntensity = params.environmentIntensity;
		ptRenderer.material.bounces = params.bounces;
		ptRenderer.material.physicalCamera.updateFrom( camera );

		camera.updateMatrixWorld();



		if ( ! params.pause || ptRenderer.samples < 1 ) {

			for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

				ptRenderer.update();

			}

		}

		renderer.autoClear = false;
		fsQuad.render( renderer );
		renderer.autoClear = true;

	} else if ( delaySamples > 0 ) {

		delaySamples --;

	}

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}

function resetRenderer() {

	if ( params.tilesX * params.tilesY !== 1.0 ) {

		delaySamples = 1;

	}

	ptRenderer.reset();

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
	resolutionFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) containerEl.classList.add( 'checkerboard' );
		else containerEl.classList.remove( 'checkerboard' );

	} );

}

async function updateModel() {

	if ( gui ) {

		containerEl.classList.remove( 'checkerboard' );
		gui.destroy();
		gui = null;

	}

	let model, envMap;
	const manager = new LoadingManager();
	const modelInfo = models[ params.model ];

	// lighting: '../../../shared-assets/environments/lightroom_14b.hdr',
	// dimensions: {width: 768, height: 768},
	// target: {x: 0, y: 0, z: 0},
	// orbit: {theta: 0, phi: 90, radius: 1},
	// verticalFoV: 45,
	// renderSkybox: false

	let {
		orbit = {},
		target = {},
		verticalFoV = 45,
		renderSkybox = false,
		lighting = '../../shared-assets/environments/lightroom_14b.hdr',
		dimensions = { width: 768, height: 768 },
	} = modelInfo;

	console.log(modelInfo.orbit);

	orbit = Object.assign( {}, { theta: 0, phi: 90, radius: 1 }, orbit );
	target = Object.assign( {}, { x: 0, y: 0, z: 0 }, target );
	dimensions = Object.assign( {}, { width: 768, height: 768 }, dimensions );

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

		const reducer = new MaterialReducer();
		reducer.process( model );
		model.updateMatrixWorld();

		const generator = new PathTracingSceneWorker();
		const result = await generator.generate( model, { onProgress: v => {

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
		material.textures.setTextures( renderer, 2048, 2048, textures );
		material.materials.updateFrom( materials, textures );
		material.envMapInfo.updateFrom( envMap );

		generator.dispose();

		envMap.mapping = EquirectangularReflectionMapping;
		scene.environment = envMap;
		scene.background = envMap;

		loadingEl.style.visibility = 'hidden';

		creditEl.innerHTML = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		buildGui();

		loadingModel = false;
		renderer.domElement.style.visibility = 'visible';
		if ( params.checkerboardTransparency ) {

			containerEl.classList.add( 'checkerboard' );

		}

		camera.position.setFromSphericalCoords( orbit.radius, MathUtils.DEG2RAD * orbit.phi, MathUtils.DEG2RAD * orbit.theta );
		camera.position.x += target.x;
		camera.position.y += target.y;
		camera.position.z += target.z;

		const dpr = window.devicePixelRatio;
		const { width, height } = dimensions;
		renderer.setSize( width, height );
		renderer.setPixelRatio( dpr );
		ptRenderer.setSize( width * dpr, height * dpr );
		camera.aspect = width / height;
		camera.fov = verticalFoV;
		camera.updateProjectionMatrix();

		controls.target.set( target.x, target.y, target.z );
		controls.update();
		camera.updateMatrixWorld();


		ptRenderer.reset();

	};

	let modelUrl = new URL( modelInfo.model, BASE_URL ).toString();
	modelUrl = modelUrl.replace( /.*?glTF-Sample-Models/, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master' );

	manager.onLoad = onFinish;

	if ( lighting ) {

		const envUrl = new URL( lighting, BASE_URL ).toString();
		console.log(envUrl)
		new RGBELoader( manager )
			.load( envUrl, res => {

				envMap = res;

			} );

	} else {

		envMap = new DataTexture(
			new Float32Array( [ 1.0, 1.0, 1.0, 1.0 ] ),
			1,
			1,
			RGBAFormat,
			FloatType,
			EquirectangularReflectionMapping,
		);

	}

	new GLTFLoader( manager )
		.setMeshoptDecoder( MeshoptDecoder )
		.load(
			modelUrl,
			gltf => {

				model = gltf.scene;

			},
			progress => {

				if ( progress.total !== 0 && progress.total >= progress.loaded ) {

					const percent = Math.floor( 100 * progress.loaded / progress.total );
					loadingEl.innerText = `Loading : ${ percent }%`;

				}

			}
		);

}
