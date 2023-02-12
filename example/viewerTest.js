import {
	ACESFilmicToneMapping,
	NoToneMapping,
	LoadingManager,
	WebGLRenderer,
	Scene,
	PerspectiveCamera,
	MeshBasicMaterial,
	sRGBEncoding,
	CustomBlending,
	EquirectangularReflectionMapping,
	MathUtils,
	BufferAttribute,
	Group,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { PhysicalPathTracingMaterial, PathTracingRenderer, MaterialReducer } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as MikkTSpace from 'three/examples/jsm/libs/mikktspace.module.js';

const CONFIG_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json';
const BASE_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config/';

const urlParams = new URLSearchParams( window.location.search );
const maxSamples = parseInt( urlParams.get( 'samples' ) ) || - 1;
const hideUI = urlParams.get( 'hideUI' ) === 'true';
const tiles = parseInt( urlParams.get( 'tiles' ) ) || 2;
const scale = parseInt( urlParams.get( 'scale' ) ) || 1;

const params = {

	environmentIntensity: 1.0,
	multipleImportanceSampling: true,
	acesToneMapping: true,
	tilesX: tiles,
	tilesY: tiles,
	samplesPerFrame: 1,
	scale: scale,

	model: '',
	checkerboardTransparency: true,

	enable: true,
	bounces: 10,
	transmissiveBounces: 10,
	pause: false,

	displayImage: false,
	imageMode: 'overlay',
	imageOpacity: 1.0,
	imageType: 'dspbr-pt',

};

let creditEl, loadingEl, samplesEl, containerEl, imgEl;
let gui, stats, sceneInfo;
let renderer, camera;
let ptRenderer, fsQuad, controls, scene;
let loadingModel = false;
let delaySamples = 0;
let models;

init();

async function init() {

	// get elements
	creditEl = document.getElementById( 'credits' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );
	containerEl = document.getElementById( 'container' );
	imgEl = document.querySelector( 'img' );

	if ( hideUI ) {

		containerEl.style.background = 'transparent';
		document.body.style.background = 'transparent';

	}

	// init renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.physicallyCorrectLights = true;
	containerEl.appendChild( renderer.domElement );

	// init scene
	scene = new Scene();

	// init camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PerspectiveCamera( 60, aspect, 0.01, 500 );
	camera.position.set( - 1, 0.25, 1 );

	// init path tracer
	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.tiles.set( params.tilesX, params.tilesY );


	// init fsquad
	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending
	} ) );

	// init controls
	controls = new OrbitControls( camera, containerEl );
	controls.addEventListener( 'change', resetRenderer );

	// init stats
	stats = new Stats();
	if ( ! hideUI ) {

		containerEl.appendChild( stats.dom );

	} else {

		creditEl.remove();
		samplesEl.remove();

	}

	// init models
	const { scenarios } = await ( await fetch( CONFIG_URL ) ).json();
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

	if ( ptRenderer.samples >= maxSamples && maxSamples !== - 1 ) {

		return;

	}

	stats.update();

	imgEl.style.display = ! params.displayImage ? 'none' : 'inline-block';
	imgEl.style.opacity = params.imageMode === 'side-by-side' ? 1.0 : params.imageOpacity;
	imgEl.style.position = params.imageMode === 'side-by-side' ? 'initial' : 'absolute';
	imgEl.style.width = renderer.domElement.style.width;
	imgEl.style.height = renderer.domElement.style.height;

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
		ptRenderer.material.bounces = params.bounces;
		ptRenderer.material.transmissiveBounces = params.transmissiveBounces;
		ptRenderer.material.physicalCamera.updateFrom( camera );
		ptRenderer.material.environmentIntensity = params.environmentIntensity;

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

	if ( ptRenderer.samples >= maxSamples && maxSamples !== - 1 ) {

		requestAnimationFrame( () => {

			window.dispatchEvent( new Event( 'render-complete' ) );

		} );

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

	if ( hideUI ) {

		return;

	}

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	gui.add( params, 'model', Object.keys( models ) ).onChange( updateModel );

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'scale', 0, 1 ).onChange( v => {

		const dpr = window.devicePixelRatio;
		let { dimensions = {} } = models[ params.model ];
		dimensions = Object.assign( {}, { width: 768, height: 768 }, dimensions );

		const { width, height } = dimensions;
		ptRenderer.setSize( width * dpr * v, height * dpr * v );
		ptRenderer.reset();

	} );
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
	pathTracingFolder.add( params, 'transmissiveBounces', 1, 20, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'environmentIntensity', 0, 5 ).onChange( () => {

		ptRenderer.reset();

	} );

	const comparisonFolder = gui.addFolder( 'comparison' );
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

	const resolutionFolder = gui.addFolder( 'resolution' );
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

	window.location.hash = params.model;

	let {
		orbit = {},
		target = {},
		dimensions = {},
	} = modelInfo;

	const {
		verticalFoV = 45,
		renderSkybox = false,
		lighting = '../../../shared-assets/environments/lightroom_14b.hdr',
	} = modelInfo;

	orbit = Object.assign( {}, { theta: 0, phi: 90, radius: 1 }, orbit );
	target = Object.assign( {}, { x: 0, y: 0, z: 0 }, target );
	dimensions = Object.assign( {}, { width: 768, height: 768 }, dimensions );

	// add a minimal radius so the camera orientation is correct when radius is 0
	orbit.radius = Math.max( orbit.radius, 1e-5 );

	loadingModel = true;
	containerEl.style.display = 'none';
	samplesEl.innerText = '--';
	creditEl.innerText = '--';
	loadingEl.innerText = 'Loading';
	loadingEl.style.visibility = 'visible';

	updateImage();

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

		await MikkTSpace.ready;

		const reducer = new MaterialReducer();
		reducer.process( model );

		const targetGroup = new Group();
		targetGroup.position.set( - target.x, - target.y, - target.z );
		targetGroup.add( model );

		model = targetGroup;
		model.updateMatrixWorld();

		model.traverse( c => {

			if ( c.geometry ) {

				if ( ! c.geometry.hasAttribute( 'normal' ) ) {

					c.geometry.computeVertexNormals();

				}

				if ( ! c.geometry.attributes.tangent ) {

					if ( c.geometry.hasAttribute( 'uv' ) ) {

						BufferGeometryUtils.computeMikkTSpaceTangents( c.geometry, MikkTSpace );
						c.material = c.material.clone();
						if ( c.material.normalScale ) c.material.normalScale.y *= - 1;
						if ( c.material.clearcoatNormalScale ) c.material.clearcoatNormalScale.y *= - 1;

					} else {

						c.geometry.setAttribute(
							'tangent',
							new BufferAttribute( new Float32Array( c.geometry.attributes.position.count * 4 ), 4, false ),
						);

					}

				}

			}

		} );

		const generator = new PathTracingSceneWorker();
		const result = await generator.generate( model, { onProgress: v => {

			const percent = Math.floor( 100 * v );
			loadingEl.innerText = `Building BVH : ${ percent }%`;

		} } );

		sceneInfo = result;
		scene.add( sceneInfo.scene );

		const { bvh, textures, materials, lights } = result;
		const geometry = bvh.geometry;
		const material = ptRenderer.material;

		material.bvh.updateFrom( bvh );
		material.attributesArray.updateFrom(
			geometry.attributes.normal,
			geometry.attributes.tangent,
			geometry.attributes.uv,
			geometry.attributes.color,
		);
		material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
		material.textures.setTextures( renderer, 2048, 2048, textures );
		material.materials.updateFrom( materials, textures );
		material.envMapInfo.updateFrom( envMap );
		material.lights.updateFrom( lights );

		generator.dispose();

		loadingEl.style.visibility = 'hidden';

		creditEl.innerHTML = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		buildGui();

		geometry.computeBoundingSphere();

		// mirror the model-viewer near / far planes
		const radius = Math.max( orbit.radius, geometry.boundingSphere.radius );
		camera.near = 2 * radius / 1000;
		camera.far = 2 * radius;
		camera.updateProjectionMatrix();
		camera.position.setFromSphericalCoords( orbit.radius, MathUtils.DEG2RAD * orbit.phi, MathUtils.DEG2RAD * orbit.theta );

		const dpr = window.devicePixelRatio;
		const { width, height } = dimensions;
		renderer.setSize( width, height );
		renderer.setPixelRatio( dpr );
		ptRenderer.setSize( width * dpr * params.scale, height * dpr * params.scale );
		camera.aspect = width / height;
		camera.fov = verticalFoV;
		camera.updateProjectionMatrix();

		controls.update();
		scene.updateMatrixWorld();
		camera.updateMatrixWorld();

		envMap.mapping = EquirectangularReflectionMapping;
		scene.environment = envMap;
		if ( renderSkybox ) {

			scene.background = envMap;
			ptRenderer.material.backgroundAlpha = 1;

		} else {

			renderer.setClearAlpha( 0 );
			scene.background = null;
			ptRenderer.material.backgroundAlpha = 0;

		}

		ptRenderer.reset();

		containerEl.style.display = 'flex';
		loadingModel = false;
		if ( params.checkerboardTransparency ) {

			containerEl.classList.add( 'checkerboard' );

		}

	};

	let modelUrl = new URL( modelInfo.model, BASE_URL ).toString();
	modelUrl = modelUrl.replace( /.*?glTF-Sample-Models/, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master' );

	manager.onLoad = onFinish;

	const envUrl = new URL( lighting, BASE_URL ).toString();
	new RGBELoader( manager )
		.load( envUrl, res => {

			envMap = res;

		} );

	new GLTFLoader( manager )
		.setMeshoptDecoder( MeshoptDecoder )
		.load(
			modelUrl,
			gltf => {

				model = gltf.scene.clone();

			},
			progress => {

				if ( progress.total !== 0 && progress.total >= progress.loaded ) {

					const percent = Math.floor( 100 * progress.loaded / progress.total );
					loadingEl.innerText = `Loading : ${ percent }%`;

				}

			}
		);

}

function updateImage() {

	imgEl.src = `https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/goldens/${ params.model }/${ params.imageType }-golden.png`;

}
