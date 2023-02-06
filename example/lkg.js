import {
	ACESFilmicToneMapping,
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
	MeshBasicMaterial,
	sRGBEncoding,
	CustomBlending,
	EquirectangularReflectionMapping,
	MathUtils,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { PhysicalPathTracingMaterial, QuiltPathTracingRenderer, MaterialReducer, PhysicalCamera } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { QuiltPreviewMaterial } from './materials/QuiltPreviewMaterial.js';

// import { LookingGlassWebXRPolyfill, LookingGlassConfig } from '@lookingglass/webxr/dist/@lookingglass/webxr.js';
// import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

// model and map urls
const MODEL_NAME = '6814-1 - Ice Tunnelator.mpd';
const ENVMAP_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';
const MODEL_URL = `https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models/${ MODEL_NAME }`;
const MATERIALS_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr';
const PARTS_PATH = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';

const LKG_WIDTH = 420;
const LKG_HEIGHT = 560;
const NUM_VIEWS = 54;

// https://github.com/Looking-Glass/looking-glass-webxr/blob/93508561550e131403b63dd9eff91eb8de0942ca/src/LookingGlassConfig.js#L113
const NUM_PIXELS = LKG_WIDTH * LKG_HEIGHT * NUM_VIEWS;
const BUFFER_WIDTH = 2 ** Math.ceil( Math.log2( Math.max( Math.sqrt( NUM_PIXELS ), LKG_WIDTH ) ) );

const QUILT_TILES_X = Math.floor( BUFFER_WIDTH / LKG_WIDTH );
const QUILT_TILES_Y = Math.ceil( NUM_VIEWS / QUILT_TILES_X );
const QUILT_WIDTH = LKG_WIDTH * QUILT_TILES_X;
const QUILT_HEIGHT = LKG_HEIGHT * QUILT_TILES_Y;
const VIEWER_DISTANCE = 0.5;
// const BUFFER_HEIGHT = 2 ** Math.ceil( Math.log2( QUILT_TILES_Y * LKG_HEIGHT ) );

const DISPLAY_HEIGHT = 6.1 * 0.0254;
const DISPLAY_WIDTH = DISPLAY_HEIGHT * LKG_WIDTH / LKG_HEIGHT;

const params = {

	resolutionScale: 1,
	tiles: 1,
	samplesPerFrame: 1,

	enable: true,
	bounces: 5,
	filterGlossyFactor: 0.5,
	pause: false,

	tiltingPreview: true,
	animationSpeed: 1,

	viewCone: 35,
	viewerDistance: VIEWER_DISTANCE,

	saveImage: () => {

		saveImage();

	},

};

let loadingEl, samplesEl, distEl;
let gui, stats;
let renderer, camera;
let ptRenderer, fsQuad, previewQuad, controls, scene;

init();

async function init() {

	distEl = document.getElementById( 'distance' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.physicallyCorrectLights = true;
	renderer.xr.enabled = true;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	// initialize the camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PhysicalCamera( 60, aspect, 0.025, 500 );
	camera.position.set( - 1, 0.25, 1 ).normalize().multiplyScalar( VIEWER_DISTANCE );
	camera.bokehSize = 0;

	// initialize the quilt renderer
	ptRenderer = new QuiltPathTracingRenderer( renderer );
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.camera = camera;

	// lkg quilt parameters
	ptRenderer.setFromDisplayView( VIEWER_DISTANCE, DISPLAY_WIDTH, DISPLAY_HEIGHT );
	ptRenderer.setSize( QUILT_WIDTH, QUILT_HEIGHT );
	ptRenderer.quiltDimensions.set( QUILT_TILES_X, QUILT_TILES_Y );
	ptRenderer.viewCount = NUM_VIEWS;

	camera.fov = ptRenderer.viewFoV * MathUtils.RAD2DEG;
	camera.updateProjectionMatrix();

	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
	} ) );

	previewQuad = new FullScreenQuad( new QuiltPreviewMaterial( {
		quiltMap: ptRenderer.target.texture,
		quiltDimensions: ptRenderer.quiltDimensions,
		aspectRatio: ptRenderer.displayAspect,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	// load the environment map
	new RGBELoader()
		.load( ENVMAP_URL, texture => {

			texture.mapping = EquirectangularReflectionMapping;
			scene.environment = texture;
			scene.background = texture;
			ptRenderer.material.envMapInfo.updateFrom( texture );
			ptRenderer.reset();

		} );

	// load the lego model
	let failed = false;
	const manager = new LoadingManager();
	manager.onProgress = ( url, loaded, total ) => {

		if ( failed ) {

			return;

		}

		const percent = Math.floor( 100 * loaded / total );
		loadingEl.innerText = `Loading : ${ percent }%`;

	};

	let generator;
	const loader = new LDrawLoader( manager );
	await loader.preloadMaterials( MATERIALS_URL );
	loader
		.setPartsLibraryPath( PARTS_PATH )
		.loadAsync( MODEL_URL )
		.then( result => {

			// get a merged version of the model
			const model = LDrawUtils.mergeObject( result );
			model.rotation.set( Math.PI, 0, 0 );

			// remove the non mesh components
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

			// generate the floor
			const floorTex = generateRadialFloorTexture( 2048 );
			const floorPlane = new Mesh(
				new PlaneGeometry(),
				new MeshStandardMaterial( {
					map: floorTex,
					transparent: true,
					color: 0x111111,
					roughness: 0.2,
					metalness: 0.2,
					side: DoubleSide,
				} )
			);
			floorPlane.scale.setScalar( 5 );
			floorPlane.rotation.x = - Math.PI / 2;

			// center the model
			const box = new Box3();
			box.setFromObject( model );
			model.position
				.addScaledVector( box.min, - 0.5 )
				.addScaledVector( box.max, - 0.5 );

			const sphere = new Sphere();
			box.getBoundingSphere( sphere );

			// scale the model to 0.07 m so it fits within the LKG view volume
			model.scale.setScalar( 0.07 / sphere.radius );
			model.position.multiplyScalar( 0.07 / sphere.radius );
			model.position.x += 0.006;
			model.position.z += 0.006;
			model.updateMatrixWorld();
			box.setFromObject( model );

			const group = new Group();
			floorPlane.position.y = box.min.y;
			group.add( model, floorPlane );
			group.updateMatrixWorld( true );

			const reducer = new MaterialReducer();
			reducer.process( group );

			generator = new PathTracingSceneWorker();
			return generator.generate( group, { onProgress: v => {

				const percent = Math.floor( 100 * v );
				loadingEl.innerText = `Building BVH : ${ percent }%`;

			} } );

		} )
		.then( result => {

			scene.add( result.scene );

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
			renderer.domElement.style.visibility = 'visible';
			ptRenderer.reset();

			renderer.setAnimationLoop( animate );

		} )
		.catch( err => {

			failed = true;
			loadingEl.innerText = 'Failed to load model. ' + err.message;

		} );

	stats = new Stats();
	document.body.appendChild( stats.dom );

	// initialize lkg config and xr button
	// const config = LookingGlassConfig;
	// config.tileHeight = LKG_HEIGHT;
	// config.numViews = NUM_VIEWS;
	// config.inlineView = 2;
	// new LookingGlassWebXRPolyfill();
	// document.body.append( VRButton.createButton( renderer ) );

	onResize();
	buildGui();

	window.addEventListener( 'resize', onResize );

}

function animate() {

	// skip rendering if we still haven't loaded the env map
	if ( ! scene.environment ) {

		return;

	}


	// disable the xr component so three.js doesn't hijack the camera. But we need it enabled otherwise so
	// we can start an xr session.
	renderer.xr.enabled = false;
	stats.update();

	if ( ptRenderer.samples < 1.0 || ! params.enable ) {

		renderer.render( scene, camera );

	}

	if ( params.enable ) {

		const samples = Math.floor( ptRenderer.samples );
		samplesEl.innerText = `samples: ${ samples }`;

		ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
		ptRenderer.material.bounces = params.bounces;
		ptRenderer.material.physicalCamera.updateFrom( camera );

		camera.updateMatrixWorld();

		if ( ! params.pause || ptRenderer.samples < 1 ) {

			for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

				ptRenderer.update();

			}

		}

		renderer.autoClear = false;

		if ( ptRenderer.samples > 1 && params.tiltingPreview && ! renderer.xr.isPresenting ) {

			const displayIndex = ( 0.5 + 0.5 * Math.sin( params.animationSpeed * window.performance.now() * 0.0025 ) ) * ptRenderer.viewCount;
			previewQuad.material.displayIndex = Math.floor( displayIndex );
			previewQuad.material.aspectRatio = ptRenderer.displayAspect * window.innerHeight / window.innerWidth;
			previewQuad.material.heightScale = Math.min( LKG_HEIGHT / window.innerHeight, 1.0 );
			previewQuad.render( renderer );

		} else {

			fsQuad.render( renderer );

		}

		renderer.autoClear = true;

	}

	// re enable the xr manager
	renderer.xr.enabled = true;
	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;
	distEl.innerText = `Distance: ${ camera.position.length().toFixed( 2 ) }`;

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

}

function saveImage() {

	renderer.setSize( ptRenderer.target.width, ptRenderer.target.height );
	fsQuad.render( renderer );

	const imageURL = renderer.domElement.toDataURL( 'image/png' );
	const anchor = document.createElement( 'a' );
	anchor.href = imageURL;
	anchor.download = 'preview.png';
	anchor.click();
	anchor.remove();

	onResize();

}

function buildGui() {

	gui = new GUI();

	gui.add( params, 'enable' );
	gui.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( v => {

		ptRenderer.setSize( v * QUILT_WIDTH, v * QUILT_HEIGHT );
		ptRenderer.reset();

	} );
	gui.add( params, 'saveImage' );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'pause' );
	ptFolder.add( params, 'bounces', 1, 20, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'tiles', 1, 3, 1 ).onChange( v => {

		ptRenderer.tiles.setScalar( v );

	} );

	const lkgFolder = gui.addFolder( 'Looking Glass Views' );
	lkgFolder.add( params, 'viewCone', 10, 70, 0.1 ).onChange( v => {

		ptRenderer.viewCone = v * MathUtils.DEG2RAD;
		ptRenderer.reset();

	} );
	lkgFolder.add( params, 'viewerDistance', 0.2, 2, 0.1 ).onChange( v => {

		ptRenderer.setFromDisplayView( v, DISPLAY_WIDTH, DISPLAY_HEIGHT );
		ptRenderer.reset();

	} );

	const quiltPreviewFolder = gui.addFolder( 'Preview' );
	quiltPreviewFolder.add( params, 'tiltingPreview' );
	quiltPreviewFolder.add( params, 'animationSpeed', 0, 2 );
	quiltPreviewFolder.open();

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
