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
	WebGLRenderer,
	Scene,
	PerspectiveCamera,
	OrthographicCamera,
	MeshBasicMaterial,
	sRGBEncoding,
	CustomBlending,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { PhysicalPathTracingMaterial, PathTracingRenderer, MaterialReducer, BlurredEnvMapGenerator, GradientEquirectTexture, PhysicalCamera } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const ENVMAP_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models/';
const MATERIALS_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr';
const PARTS_PATH = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';

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
let floorPlane, gui, stats, sceneInfo;
let renderer, orthoCamera, perspectiveCamera, activeCamera;
let ptRenderer, fsQuad, controls, scene;
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
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.physicallyCorrectLights = true;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PhysicalCamera( 60, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 1, 0.25, 1 );

	backgroundMap = new GradientEquirectTexture();
	backgroundMap.topColor.set( params.bgGradientTop );
	backgroundMap.bottomColor.set( params.bgGradientBottom );
	backgroundMap.update();

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.backgroundMap = backgroundMap;

	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', resetRenderer );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	new RGBELoader()
		.load( params.envMap, texture => {

			if ( scene.environmentMap ) {

				scene.environment.dispose();
				envMap.dispose();

			}

			scene.environment = texture;
			ptRenderer.material.envMapInfo.updateFrom( texture );
			ptRenderer.reset();

		} );


	let failed = false;
	const manager = new LoadingManager();
	manager.onProgress = ( url, loaded, total ) => {

		if ( failed ) {

			return;

		}

		const percent = Math.floor( 100 * loaded / total );
		loadingEl.innerText = `Loading : ${ percent }%`;

	};

	const loader = new LDrawLoader( manager );
	await loader.preloadMaterials( MATERIALS_URL );
	loader
		.setPartsLibraryPath( PARTS_PATH )
		.loadAsync( MODEL_URL )
		.then( async result => {

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

			convertOpacityToTransmission( model, 1.4 );



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
			const generatedInfo = await generator.generate( group, { onProgress: v => {

				const percent = Math.floor( 100 * v );
				loadingEl.innerText = `Building BVH : ${ percent }%`;

			} } );

			sceneInfo = generatedInfo;
			scene.add( sceneInfo.scene );

			const { bvh, textures, materials } = generatedInfo;
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

			generator.dispose();

			loadingEl.style.visibility = 'hidden';
			loadingModel = false;
			renderer.domElement.style.visibility = 'visible';
			ptRenderer.reset();

		} )
		.catch( err => {

			failed = true;
			loadingEl.innerText = 'Failed to load model. ' + err.message;

		} );


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
	ptRenderer.tiles.set( params.tilesX, params.tilesY );

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
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	resolutionFolder.open();

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
				newMaterial.thickness = 1.0;
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

		if ( modelInfo.opacityToTransmission ) {

			convertOpacityToTransmission( model, modelInfo.ior || 1.5 );

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
		material.attributesArray.updateFrom(
			geometry.attributes.normal,
			geometry.attributes.tangent,
			geometry.attributes.uv,
			geometry.attributes.color,
		);
		material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
		material.textures.setTextures( renderer, 2048, 2048, textures );
		material.materials.updateFrom( materials, textures );

		generator.dispose();

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

		let failed = false;
		const manager = new LoadingManager();
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
