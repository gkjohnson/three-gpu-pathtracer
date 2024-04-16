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
	CustomBlending,
	EquirectangularReflectionMapping,
	MathUtils,
	Vector4
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { PathTracingSceneGenerator } from '../src/core/PathTracingSceneGenerator.js';
import { PhysicalCamera } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { QuiltPreviewMaterial } from './materials/QuiltPreviewMaterial.js';
import { QuiltPathTracingRenderer } from '../src/core/QuiltPathTracingRenderer.js';

import { LookingGlassWebXRPolyfill, LookingGlassConfig } from '@lookingglass/webxr/dist/@lookingglass/webxr.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

// lkg display constants
const LKG_WIDTH = 420;
const LKG_HEIGHT = 560;
const VIEWER_DISTANCE = 0.5;
const DISPLAY_HEIGHT = 6.1 * 0.0254;
const DISPLAY_WIDTH = DISPLAY_HEIGHT * LKG_WIDTH / LKG_HEIGHT;

// model and map urls
const ENVMAP_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';
const MATERIALS_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr';
const PARTS_PATH = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
const MODELS = {
	'X-Wing': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/7140-1-X-wingFighter.mpd_Packed.mpd',
	'UCS AT-ST': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd',
	'Death Star': 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models/10143-1 - Death Star II.mpd',
	'Lunar Vehicle': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/1621-1-LunarMPVVehicle.mpd_Packed.mpd',
};

[
	'6814-1 - Ice Tunnelator.mpd',
	'6861-2 - Super Model Building Instruction.mpd',
	'75060 - Slave I.mpd',
	'6983-1 - Ice Station Odyssey.mpd',
	'6835-1 - Saucer Scout.mpd',
	'21311 - Voltron - Voltron.mpd',
	'21303 - WALLE.mpd',
	'1180-1 - Space Port Moon Buggy.mpd',
	'10179-1 - Millennium Falcon - UCS.mpd',
	'6232-1 - Skeleton Crew.mpd',
	'6235 - Buried Treasure.mpd',
].forEach( name => {

	const cleanedName = name.replace( /.+?\s-\s/, '' ).replace( /\.mpd$/, '' );
	MODELS[ cleanedName ] = `https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models/${ name }`;

} );

// get the hash model name
const modelName = decodeURI( window.location.hash.replace( /^#/, '' ) );

const params = {

	enable: true,
	model: modelName in MODELS ? modelName : 'Voltron - Voltron',
	renderScale: 1,
	tiles: 1,

	samplesPerFrame: 1,
	bounces: 5,
	filterGlossyFactor: 0.5,
	pause: false,

	tiltingPreview: true,
	animationSpeed: 1,

	numViews: 54,
	viewCone: 35,
	viewerDistance: VIEWER_DISTANCE,

	saveQuilt: () => {

		saveQuilt();

	},

};

let loadingEl, samplesEl, distEl;
let gui, stats;
let renderer, camera;
let ptRenderer, fsQuad, previewQuad, controls, scene;
let saveButton;
const _viewport = new Vector4();

// initialize lkg parameters
let lkgParams = getLkgParams( params.numViews );

init();

async function init() {

	// get elements
	distEl = document.getElementById( 'distance' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	// init renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.physicallyCorrectLights = true;
	renderer.xr.enabled = true;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	// initialize the camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PhysicalCamera( 60, aspect, 0.025, 500 );
	camera.position.set( 0.43, 0.06, - 0.2 ).normalize().multiplyScalar( 0.48 );
	camera.bokehSize = 0;

	// initialize the quilt renderer
	ptRenderer = new QuiltPathTracingRenderer( renderer );
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.camera = camera;

	camera.fov = ptRenderer.viewFoV * MathUtils.RAD2DEG;
	camera.updateProjectionMatrix();

	// initialize quads
	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
	} ) );

	previewQuad = new FullScreenQuad( new QuiltPreviewMaterial( {
		quiltMap: ptRenderer.target.texture,
		quiltDimensions: ptRenderer.quiltDimensions,
		aspectRatio: ptRenderer.displayAspect,
	} ) );

	// init controls
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

	// Load the lego model
	let generator;
	const loader = new LDrawLoader( manager );
	await loader.preloadMaterials( MATERIALS_URL );
	loader
		.setPartsLibraryPath( PARTS_PATH )
		.loadAsync( MODELS[ params.model ] )
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

			// conver materials
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

			const boxRadius2d = Math.sqrt( box.min.x ** 2 + box.min.z ** 2 );
			const widthRadiusScale = 0.06 / Math.min( boxRadius2d, sphere.radius );
			const heightRadiusScale = 0.14 / ( box.max.y - box.min.y );
			const scaleRadius = Math.min( widthRadiusScale, heightRadiusScale );

			// scale the model to 0.06 m so it fits within the LKG view volume
			model.scale.setScalar( scaleRadius );
			model.position.multiplyScalar( scaleRadius );
			model.updateMatrixWorld();
			box.setFromObject( model );

			// generate the view group
			const group = new Group();
			floorPlane.position.y = box.min.y;
			group.add( model, floorPlane );
			group.updateMatrixWorld( true );

			generator = new PathTracingSceneGenerator();
			return generator.generate( group, { onProgress: v => {

				const percent = Math.floor( 100 * v );
				loadingEl.innerText = `Building BVH : ${ percent }%`;

			} } );

		} )
		.then( result => {

			scene.add( result.scene );

			const { bvh, textures, materials, geometry } = result;
			const material = ptRenderer.material;

			material.bvh.updateFrom( bvh );
			material.attributesArray.updateFrom(
				geometry.attributes.normal,
				geometry.attributes.tangent,
				geometry.attributes.uv,
				geometry.attributes.color,
			);
			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
			material.textures.setTextures( renderer, textures, 2048, 2048 );
			material.materials.updateFrom( materials, textures );

			generator.dispose();

			loadingEl.style.visibility = 'hidden';
			renderer.domElement.style.visibility = 'visible';
			ptRenderer.reset();

			// initialize LKG XR
			new LookingGlassWebXRPolyfill();
			document.body.append( VRButton.createButton( renderer ) );

			// start render loop
			renderer.setAnimationLoop( animate );

		} )
		.catch( err => {

			failed = true;
			loadingEl.innerText = 'Failed to load model. ' + err.message;

		} );

	stats = new Stats();
	document.body.appendChild( stats.dom );

	// initialize lkg config and xr button
	LookingGlassConfig.tileHeight = LKG_HEIGHT;
	LookingGlassConfig.numViews = params.numViews;
	LookingGlassConfig.inlineView = 2;

	onResize();
	onLkgParamsChange();
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

		// set path tracer variables
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

			// render the animated tilting preview
			const displayIndex = ( 0.5 + 0.5 * Math.sin( params.animationSpeed * window.performance.now() * 0.0025 ) ) * ptRenderer.viewCount;
			previewQuad.material.displayIndex = Math.floor( displayIndex );
			previewQuad.material.aspectRatio = ptRenderer.displayAspect * window.innerHeight / window.innerWidth;
			previewQuad.material.heightScale = Math.min( LKG_HEIGHT / window.innerHeight, 1.0 );
			previewQuad.render( renderer );

		} else if ( renderer.xr.isPresenting ) {

			// only display the first view if we haven't rendered the full number of views yet
			LookingGlassConfig.numViews = ptRenderer.samples < 1.0 ? 1 : params.numViews;

			renderer.getViewport( _viewport );
			renderer.setViewport( 0, 0, lkgParams.quiltWidth, lkgParams.quiltHeight );
			fsQuad.render( renderer );
			renderer.setViewport( _viewport );

		} else {

			// render the full quilt
			fsQuad.render( renderer );

		}

		renderer.autoClear = true;

	}

	// toggle save button
	saveButton.disable( renderer.xr.isPresenting );

	// re enable the xr manager
	renderer.xr.enabled = true;
	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;
	distEl.innerText = `Distance: ${ camera.position.length().toFixed( 2 ) }`;

}

// returns a set of derivative LKG view parameters based on the above constants and
// passed number of views
function getLkgParams( numViews ) {

	// https://github.com/Looking-Glass/looking-glass-webxr/blob/93508561550e131403b63dd9eff91eb8de0942ca/src/LookingGlassConfig.js#L113
	const numPixels = LKG_WIDTH * LKG_HEIGHT * numViews;
	const bufferWidth = 2 ** Math.ceil( Math.log2( Math.max( Math.sqrt( numPixels ), LKG_WIDTH ) ) );

	const quiltTilesX = Math.floor( bufferWidth / LKG_WIDTH );
	const quiltTilesY = Math.ceil( numViews / quiltTilesX );
	const quiltWidth = LKG_WIDTH * quiltTilesX;
	const quiltHeight = LKG_HEIGHT * quiltTilesY;

	return {
		numViews,
		numPixels,
		bufferWidth,
		quiltTilesX,
		quiltTilesY,
		quiltWidth,
		quiltHeight,
	};

}

// callback when a parameter impacting the LKG rendering changes
function onLkgParamsChange() {

	const { renderScale, viewCone, viewerDistance } = params;

	lkgParams = getLkgParams( params.numViews );

	LookingGlassConfig.numViews = lkgParams.numViews;
	ptRenderer.viewCount = lkgParams.numViews;
	ptRenderer.viewCone = viewCone * MathUtils.DEG2RAD;
	ptRenderer.setFromDisplayView( viewerDistance, DISPLAY_WIDTH, DISPLAY_HEIGHT );
	ptRenderer.setSize( renderScale * lkgParams.quiltWidth, renderScale * lkgParams.quiltHeight );
	ptRenderer.quiltDimensions.set( lkgParams.quiltTilesX, lkgParams.quiltTilesY );

}

// resize callback
function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

}

// save the canvas
function saveQuilt() {

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

// build the gui
function buildGui() {

	gui = new GUI();

	gui.add( params, 'model', Object.keys( MODELS ) ).onChange( v => {

		window.location.hash = v;
		window.location.reload();

	} );
	gui.add( params, 'enable' );
	gui.add( params, 'renderScale', 0.1, 1.0, 0.01 ).onChange( () => {

		onLkgParamsChange();
		ptRenderer.reset();

	} );
	saveButton = gui.add( params, 'saveQuilt' );

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
	lkgFolder.add( params, 'numViews', 1, 100, 1 ).onChange( () => {

		onLkgParamsChange();
		ptRenderer.reset();

	} );
	lkgFolder.add( params, 'viewCone', 10, 70, 0.1 ).onChange( () => {

		onLkgParamsChange();
		ptRenderer.reset();

	} );
	lkgFolder.add( params, 'viewerDistance', 0.2, 2, 0.1 ).onChange( () => {

		onLkgParamsChange();
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
