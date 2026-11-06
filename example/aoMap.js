import {
	Box3,
	Color,
	EquirectangularReflectionMapping,
	MeshBasicMaterial,
	MeshBasicNodeMaterial,
	PerspectiveCamera,
	QuadMesh,
	Scene,
	Sphere,
	Texture,
	WebGPURenderer,
} from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './src/LoaderElement.js';
import { WebGPUPathTracer, OIDNDenoiser, UVUnwrapper, AOMapCamera, AOMapShadingModel, GutterFiller, SeamStitcher } from 'three-gpu-pathtracer/webgpu';
import { initUNetFromURL } from 'oidn-webgpu';

const MODEL_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';
const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';
const WEIGHTS_COLOR_URL = new URL( './src/denoise/rt_hdr.tza', import.meta.url ).toString();
const CREDITS = 'Flight Helmet model from the Khronos glTF sample models';
const DESCRIPTION = 'Ambient occlusion baked into a uv atlas and displayed as the only shading.';

const MAP_SIZE = 2048;
const MAX_SAMPLES = 16;

// occluders further than this, in world units, don't count
const AO_RADIUS = 0.1;

const params = {
	view: 'map',
	resolution: MAP_SIZE,
	regenerate: () => pathTracer.reset(),
};

let renderer, pathTracer, camera, scene, loader;
let model, uvCamera, gutterFiller, filledMap, seamStitcher, mapNode, textureQuad;
let pbrModel, pbrMaterials, mapModel, mapMaterial;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	// the bake camera reads the scene geometry, which needs more storage buffers than the default
	// TODO: drop the raised limit once the next three.js release lets us lower the buffer bindings
	const adapter = await navigator.gpu.requestAdapter();
	// the denoiser keeps the whole image in one buffer, past the default size limit at 4096
	const { maxStorageBuffersPerShaderStage, maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
	const requiredLimits = { maxStorageBuffersPerShaderStage, maxStorageBufferBindingSize, maxBufferSize };
	renderer = new WebGPURenderer( { antialias: true, requiredLimits, trackTimestamp: true } );
	await renderer.init();
	document.body.appendChild( renderer.domElement );

	// load the model and unwrap its meshes into one atlas, packing their own uv charts
	const [ gltf, environment ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		new HDRLoader().loadAsync( ENV_URL ),
	] );
	environment.mapping = EquirectangularReflectionMapping;

	model = gltf.scene;
	const unwrapper = new UVUnwrapper();
	unwrapper.resolution = MAP_SIZE;
	unwrapper.useInputUVs = true;
	await unwrapper.generate( model );

	const { center, radius } = new Box3().setFromObject( model ).getBoundingSphere( new Sphere() );

	// the views: a copy of the model with its own materials using the map as their ao map, and a copy
	// shaded by the map alone
	pbrModel = model.clone();
	pbrMaterials = [];
	pbrModel.traverse( c => {

		if ( c.isMesh ) {

			c.material = c.material.clone();
			pbrMaterials.push( c.material );

		}

	} );

	mapModel = model.clone();
	mapMaterial = new MeshBasicMaterial();
	mapModel.traverse( c => {

		if ( c.isMesh ) {

			c.material = mapMaterial;

		}

	} );

	scene = new Scene();
	scene.environment = environment;
	scene.add( pbrModel, mapModel );

	// the bake: the model under a white sky, so a ray that escapes reads one
	const bakeScene = new Scene();
	bakeScene.background = new Color( 0xffffff );
	bakeScene.add( model );

	// path tracer, rendering the map from a camera that starts each path at a texel of the atlas
	uvCamera = new AOMapCamera( model );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.synchronizeRenderSize = false;
	pathTracer.renderToCanvas = false;
	pathTracer.maxSamples = MAX_SAMPLES;
	pathTracer.setShadingModel( new AOMapShadingModel( { radius: AO_RADIUS } ) );

	pathTracer.addEventListener( 'progress', ( { stage, progress, samples } ) => {

		loader.setStage( stage, progress, samples );

	} );

	pathTracer.setScene( bakeScene, uvCamera );
	setResolution( params.resolution );

	// the finished map gets its gutters filled, so chart edges don't blur into empty texels, then
	// denoised and stitched along the chart seams. The rays leave the texel, so the albedo and normal
	// guides would show the occluders
	const denoiser = new OIDNDenoiser( {
		initUNetFromURL,
		colorWeightsUrl: WEIGHTS_COLOR_URL,
		useAuxiliaryBuffers: false,
		onBeforeDenoise: color => ( { color: gutterFiller.fill( color, uvCamera.idTexture.texture, filledMap ) } ),
	} );
	pathTracer.setDenoiser( denoiser );

	// shows the stitched map once the bake and its denoise finish
	pathTracer.addEventListener( 'complete', () => {

		setMap( seamStitcher.update( denoiser.texture ) );

	} );

	// camera, centered on the mask
	camera = new PerspectiveCamera( 50, 1, 0.01, 100 );
	camera.position.set( center.x + radius * 0.9, center.y + radius * 0.6, center.z + radius * 2.6 );

	const controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( center.x, center.y + radius * 0.1, center.z );
	controls.update();

	// the texture view: the map drawn to a square in the middle of the screen
	mapNode = texture( new Texture(), uv() );
	textureQuad = new QuadMesh( new MeshBasicNodeMaterial( { colorNode: mapNode } ) );

	const gui = new GUI();
	gui.add( params, 'view', [ 'pbr', 'map', 'texture' ] );
	gui.add( params, 'resolution', [ 128, 256, 512, 1024, 2048, 4096 ] ).onChange( setResolution );
	gui.add( pathTracer, 'maxSamples', 1, 100, 1 );
	gui.add( params, 'regenerate' );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

// bakes at the given size, rebuilding the gutter filler and seam stitcher for it
function setResolution( size ) {

	gutterFiller?.dispose();
	filledMap?.dispose();
	seamStitcher?.dispose();

	pathTracer.setSize( size, size );
	gutterFiller = new GutterFiller( renderer, size );
	filledMap = gutterFiller.createTarget();
	seamStitcher = new SeamStitcher( renderer, model, uvCamera.idTexture.texture );

}

function setMap( map ) {

	map.channel = 1;
	mapMaterial.map = map;
	for ( const material of pbrMaterials ) {

		material.aoMap = map;

	}

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

}

function animate() {

	requestAnimationFrame( animate );

	pathTracer.renderSample();

	// shows the raw map as it bakes
	if ( ! pathTracer.complete ) {

		setMap( pathTracer.target );

	}

	if ( params.view === 'texture' ) {

		renderTexture( mapMaterial.map );

	} else {

		pbrModel.visible = params.view === 'pbr';
		mapModel.visible = params.view === 'map';
		renderer.render( scene, camera );

	}

}

function renderTexture( map ) {

	const size = Math.min( window.innerWidth, window.innerHeight );
	mapNode.value = map;
	renderer.setViewport( ( window.innerWidth - size ) / 2, ( window.innerHeight - size ) / 2, size, size );
	textureQuad.render( renderer );
	renderer.setViewport( 0, 0, window.innerWidth, window.innerHeight );

}
