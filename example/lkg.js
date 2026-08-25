import {
	ACESFilmicToneMapping,
	ArrayCamera,
	Box3,
	DoubleSide,
	EquirectangularReflectionMapping,
	Group,
	LoadingManager,
	MathUtils,
	Matrix4,
	Mesh,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	Sphere,
	Vector2,
	Vector4,
	WebGPURenderer,
} from 'three/webgpu';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineNodeMaterial.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { QuiltPreviewNodeMaterial } from './materials/QuiltPreviewNodeMaterial.js';

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
	'X-Wing': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/ldraw/officialLibrary/models/7140-1-X-wingFighter.mpd_Packed.mpd',
	'Lunar Vehicle': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/ldraw/officialLibrary/models/1621-1-LunarMPVVehicle.mpd_Packed.mpd',
};

[
	'6814-1 - Ice Tunnelator.mpd',
	'6983-1 - Ice Station Odyssey.mpd',
	'6835-1 - Saucer Scout.mpd',
	'1180-1 - Space Port Moon Buggy.mpd',
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
	model: modelName in MODELS ? modelName : 'X-Wing',
	renderScale: 1,
	tiles: 3,

	samplesPerFrame: 1,
	bounces: 15,
	filterGlossyFactor: 1,
	pause: false,

	tiltingPreview: true,
	animationSpeed: 1,

	numViews: 54,
	viewCone: 35,
	viewerDistance: VIEWER_DISTANCE,

	saveQuilt,

};

let loadingEl, samplesEl, distEl;
let renderer, camera, quiltCamera;
let pathTracer, previewQuad, scene;

// sample counts are measured asynchronously, so the average is kept for the frame
let averageSamples = 0;
const _translation = new Matrix4();
const _size = new Vector2();

// initialize lkg parameters
let lkgParams = getLkgParams( params.numViews );

init();

async function init() {

	// get elements
	distEl = document.getElementById( 'distance' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	// init renderer
	renderer = new WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	// initialize the camera
	const aspect = window.innerWidth / window.innerHeight;
	camera = new PerspectiveCamera( 60, aspect, 0.025, 500 );
	camera.position.set( 0.43, 0.06, - 0.2 ).normalize().multiplyScalar( 0.5 );
	camera.lookAt( 0, 0, 0 );
	quiltCamera = new ArrayCamera();

	// initialize the path tracer. The quilt has its own fixed resolution, independent
	// of the preview canvas, so automatic and low-resolution resizing must be disabled.
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.synchronizeRenderSize = false;
	pathTracer.dynamicLowRes = false;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.bounces = params.bounces;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;

	// initialize quads
	previewQuad = new FullScreenQuad( new QuiltPreviewNodeMaterial( {
		quiltMap: pathTracer.target,
		quiltDimensions: new Vector2(),
		aspectRatio: DISPLAY_WIDTH / DISPLAY_HEIGHT,
	} ) );

	onResize();
	onLkgParamsChange();
	buildGui();
	window.addEventListener( 'resize', onResize );

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

	try {

		const envPromise = new HDRLoader().loadAsync( ENVMAP_URL );
		const loader = new LDrawLoader( manager );
		loader.setConditionalLineMaterial( LDrawConditionalLineMaterial );
		await loader.preloadMaterials( MATERIALS_URL );
		const result = await loader
			.setPartsLibraryPath( PARTS_PATH )
			.loadAsync( MODELS[ params.model ] );

		// get a merged version of the model
		const model = LDrawUtils.mergeObject( result );
		model.rotation.set( Math.PI, - Math.PI / 2, 0 );

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

		// convert materials
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
		scene.add( group );

		loadingEl.innerText = 'Building scene';
		const envTexture = await envPromise;
		envTexture.mapping = EquirectangularReflectionMapping;
		scene.environment = envTexture;
		scene.background = envTexture;

		pathTracer.setScene( scene, quiltCamera );

		loadingEl.style.visibility = 'hidden';
		renderer.domElement.style.visibility = 'visible';
		renderer.setAnimationLoop( animate );

	} catch ( err ) {

		failed = true;
		loadingEl.innerText = 'Failed to load model. ' + err.message;

	}

}

function animate() {

	if ( ! params.enable ) {

		renderer.render( scene, camera );

	} else {

		// set path tracer variables
		pathTracer.pause = params.pause;
		const samplesPerFrame = params.pause ? 1 : params.samplesPerFrame;
		for ( let i = 0; i < samplesPerFrame; i ++ ) {

			pathTracer.renderSample();

		}

		if ( averageSamples > 1 && params.tiltingPreview ) {

			// render the animated tilting preview
			const displayIndex = ( 0.5 + 0.5 * Math.sin( params.animationSpeed * window.performance.now() * 0.0025 ) ) * params.numViews;
			previewQuad.material.displayIndex = Math.min( params.numViews - 1, Math.floor( displayIndex ) );
			previewQuad.material.aspectRatio = DISPLAY_WIDTH / DISPLAY_HEIGHT * window.innerHeight / window.innerWidth;
			previewQuad.material.heightScale = Math.min( LKG_HEIGHT / window.innerHeight, 1.0 );

		} else {

			previewQuad.material.displayIndex = - 1;

		}

		previewQuad.material.quiltMap = pathTracer.target;
		previewQuad.render( renderer );

	}

	pathTracer.getSampleCountsAsync().then( counts => averageSamples = counts.avg );

	samplesEl.innerText = `Samples: ${ Math.floor( averageSamples ) }`;
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
		quiltTilesX,
		quiltTilesY,
		quiltWidth,
		quiltHeight,
	};

}

// callback when a parameter impacting the LKG rendering changes
function onLkgParamsChange() {

	const { renderScale } = params;

	lkgParams = getLkgParams( params.numViews );
	updateQuiltCamera();

	const width = Math.max( 1, Math.floor( renderScale * lkgParams.quiltWidth ) );
	const height = Math.max( 1, Math.floor( renderScale * lkgParams.quiltHeight ) );
	pathTracer.setSize( width, height );
	previewQuad.material.quiltMap = pathTracer.target;
	previewQuad.material.quiltDimensions.set( lkgParams.quiltTilesX, lkgParams.quiltTilesY );

	pathTracer.updateCamera();

}

// Rebuild the off-axis cameras and their quilt viewports.
function updateQuiltCamera() {

	const {
		numViews,
		quiltTilesX,
		quiltTilesY,
		quiltWidth,
		quiltHeight,
	} = lkgParams;
	const { renderScale, viewCone, viewerDistance } = params;
	const width = Math.max( 1, Math.floor( renderScale * quiltWidth ) );
	const height = Math.max( 1, Math.floor( renderScale * quiltHeight ) );

	const displayHalfHeight = DISPLAY_HEIGHT * 0.5;
	const halfViewWidth = Math.tan( viewCone * MathUtils.DEG2RAD * 0.5 ) * viewerDistance;

	camera.fov = 2 * Math.atan( displayHalfHeight / viewerDistance ) * MathUtils.RAD2DEG;
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld();

	while ( quiltCamera.cameras.length < numViews ) {

		const subCamera = new PerspectiveCamera();
		subCamera.viewport = new Vector4();
		quiltCamera.cameras.push( subCamera );

	}

	quiltCamera.cameras.length = numViews;
	for ( let i = 0; i < numViews; i ++ ) {

		const viewAlpha = numViews === 1 ? 0.5 : i / ( numViews - 1 );
		const offset = MathUtils.lerp( - halfViewWidth, halfViewWidth, viewAlpha );
		const subCamera = quiltCamera.cameras[ i ];

		_translation.makeTranslation( offset, 0, 0 );
		subCamera.matrix.multiplyMatrices( camera.matrixWorld, _translation );
		subCamera.matrix.decompose( subCamera.position, subCamera.quaternion, subCamera.scale );

		subCamera.near = camera.near;
		subCamera.far = camera.far;
		subCamera.fov = camera.fov;
		subCamera.aspect = DISPLAY_WIDTH / DISPLAY_HEIGHT;
		subCamera.filmOffset = - offset * subCamera.getFilmWidth() / viewerDistance;
		subCamera.updateProjectionMatrix();

		const tileX = i % quiltTilesX;
		const tileY = Math.floor( i / quiltTilesX );
		const x0 = Math.floor( tileX * width / quiltTilesX );
		const x1 = Math.floor( ( tileX + 1 ) * width / quiltTilesX );
		const y0 = Math.floor( tileY * height / quiltTilesY );
		const y1 = Math.floor( ( tileY + 1 ) * height / quiltTilesY );
		subCamera.viewport.set( x0, y0, x1 - x0, y1 - y0 );

	}

}

// resize callback
function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

// save the canvas
function saveQuilt() {

	const target = pathTracer.target;
	renderer.getSize( _size );
	const pixelRatio = renderer.getPixelRatio();
	const displayIndex = previewQuad.material.displayIndex;

	renderer.setPixelRatio( 1 );
	renderer.setSize( target.width, target.height, false );
	renderer.setViewport( 0, 0, target.width, target.height );
	previewQuad.material.quiltMap = target;
	previewQuad.material.displayIndex = - 1;
	previewQuad.render( renderer );

	const imageURL = renderer.domElement.toDataURL( 'image/png' );
	const anchor = document.createElement( 'a' );
	anchor.href = imageURL;
	anchor.download = 'quilt.png';
	anchor.click();
	anchor.remove();

	previewQuad.material.displayIndex = displayIndex;
	renderer.setPixelRatio( pixelRatio );
	renderer.setSize( _size.x, _size.y );
	onResize();

}

// build the gui
function buildGui() {

	const gui = new GUI();

	gui.add( params, 'model', Object.keys( MODELS ) ).onChange( v => {

		window.location.hash = v;
		window.location.reload();

	} );
	gui.add( params, 'enable' );
	gui.add( params, 'renderScale', 0.1, 1.0, 0.01 ).onChange( onLkgParamsChange );
	gui.add( params, 'saveQuilt' );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'pause' );
	ptFolder.add( params, 'bounces', 1, 50, 1 ).onChange( () => {

		pathTracer.bounces = params.bounces;

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		pathTracer.filterGlossyFactor = params.filterGlossyFactor;

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'tiles', 3, 6, 1 ).onChange( v => {

		pathTracer.tiles.setScalar( v );

	} );

	const lkgFolder = gui.addFolder( 'Looking Glass Views' );
	lkgFolder.add( params, 'numViews', 1, 100, 1 ).onChange( onLkgParamsChange );
	lkgFolder.add( params, 'viewCone', 10, 70, 0.1 ).onChange( onLkgParamsChange );
	lkgFolder.add( params, 'viewerDistance', 0.2, 2, 0.1 ).onChange( onLkgParamsChange );

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

					const value = material[ key ];
					const targetValue = newMaterial[ key ];
					if ( value === null ) {

						continue;

					}

					if ( value.isTexture ) {

						newMaterial[ key ] = value;

					} else if ( value.copy && targetValue?.constructor === value.constructor ) {

						targetValue.copy( value );

					} else if ( typeof value === 'number' ) {

						newMaterial[ key ] = value;

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
