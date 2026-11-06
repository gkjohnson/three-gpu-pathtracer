import {
	ACESFilmicToneMapping,
	Box3,
	EnvironmentNode,
	EquirectangularReflectionMapping,
	Mesh,
	MeshBasicMaterial,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	QuadMesh,
	Scene,
	Sphere,
	Texture,
	WebGPURenderer,
} from 'three/webgpu';
import { texture, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './src/LoaderElement.js';
import { WebGPUPathTracer, OIDNDenoiser, UVUnwrapper, LightmapCamera, LightmapShadingModel, GutterFiller, SeamStitcher } from 'three-gpu-pathtracer/webgpu';
import { initUNetFromURL } from 'oidn-webgpu';

// the lightmap already holds the environment's diffuse light, so the environment must only add its
// reflections. three.js has no switch for that ( mrdoob/three.js#34741 ), so the diffuse term is
// diverted into a throwaway
class SpecularEnvironmentNode extends EnvironmentNode {

	setup( builder ) {

		const { iblIrradiance } = builder.context;
		builder.context.iblIrradiance = vec3( 0.0 ).toVar();
		super.setup( builder );
		builder.context.iblIrradiance = iblIrradiance;

	}

}

class LightmapViewMaterial extends MeshPhysicalNodeMaterial {

	setupEnvironment( builder ) {

		const envNode = this.envNode || builder.environmentNode;
		return envNode ? new SpecularEnvironmentNode( envNode ) : null;

	}

}

const MODEL_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';
const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';
const WEIGHTS_AUX_URL = new URL( './src/denoise/rt_hdr_alb_nrm.tza', import.meta.url ).toString();
const CREDITS = 'Flight Helmet model from the Khronos glTF sample models';
const DESCRIPTION = 'Irradiance baked into a uv atlas and applied as a lightmap.';

const MAP_SIZE = 2048;
const MAX_SAMPLES = 16;

const params = {
	view: 'pbr',
	resolution: MAP_SIZE,
	regenerate: () => pathTracer.reset(),
};

let renderer, pathTracer, camera, scene, loader;
let model, uvCamera, gutterFiller, filledColor, filledAlbedo, filledNormal, seamStitcher, mapNode, textureQuad;
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
	renderer.toneMapping = ACESFilmicToneMapping;
	await renderer.init();
	document.body.appendChild( renderer.domElement );

	const [ gltf, environment ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		new HDRLoader().loadAsync( ENV_URL ),
	] );
	environment.mapping = EquirectangularReflectionMapping;

	// the helmet on a floor that catches its shadow
	model = gltf.scene;
	const bounds = new Box3().setFromObject( model );
	const { center, radius } = bounds.getBoundingSphere( new Sphere() );

	const floor = new Mesh( new PlaneGeometry( 6 * radius, 6 * radius ), new MeshStandardMaterial( { roughness: 1 } ) );
	floor.rotation.x = - Math.PI / 2;
	floor.position.y = bounds.min.y;
	model.add( floor );

	// unwrap the meshes into one atlas, packing their own uv charts
	const unwrapper = new UVUnwrapper();
	unwrapper.resolution = MAP_SIZE;
	unwrapper.useInputUVs = true;
	await unwrapper.generate( model );

	// the views: a copy of the model with its own materials lit by the lightmap, and a copy shaded by
	// the map alone
	pbrModel = model.clone();
	pbrMaterials = [];
	pbrModel.traverse( c => {

		if ( c.isMesh ) {

			c.material = new LightmapViewMaterial().copy( c.material );
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

	// the bake: the model as it is, lit by the environment
	const bakeScene = new Scene();
	bakeScene.environment = environment;
	bakeScene.background = environment;
	bakeScene.add( model );

	// path tracer, rendering the map from a camera that lands each ray on a texel of the atlas so the
	// texel is shaded as the first hit, gathering the light arriving there
	uvCamera = new LightmapCamera( model );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.synchronizeRenderSize = false;
	pathTracer.renderToCanvas = false;
	pathTracer.maxSamples = MAX_SAMPLES;
	pathTracer.setShadingModel( new LightmapShadingModel() );

	pathTracer.addEventListener( 'progress', ( { stage, progress, samples } ) => {

		loader.setStage( stage, progress, samples );

	} );

	pathTracer.setScene( bakeScene, uvCamera );
	setResolution( params.resolution );

	// the finished map and its albedo and normal guides get their gutters filled, so chart edges don't
	// blur into empty texels or read as surface boundaries, then denoised and stitched along the chart seams
	// TODO: try a port of three.js' LightMapDenoiser ( mrdoob/three.js#35302 ) through "setDenoiser"
	const denoiser = new OIDNDenoiser( {
		initUNetFromURL,
		auxWeightsUrl: WEIGHTS_AUX_URL,
		onBeforeDenoise: ( color, albedo, normal ) => {

			const ids = uvCamera.idTexture.texture;
			return {
				color: gutterFiller.fill( color, ids, filledColor ),
				albedo: gutterFiller.fill( albedo, ids, filledAlbedo ),
				normal: gutterFiller.fill( normal, ids, filledNormal ),
			};

		},
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
	filledColor?.dispose();
	filledAlbedo?.dispose();
	filledNormal?.dispose();
	seamStitcher?.dispose();

	pathTracer.setSize( size, size );
	gutterFiller = new GutterFiller( renderer, size );
	filledColor = gutterFiller.createTarget();
	filledAlbedo = gutterFiller.createTarget();
	filledNormal = gutterFiller.createTarget();
	seamStitcher = new SeamStitcher( renderer, model, uvCamera.idTexture.texture );

}

function setMap( map ) {

	map.channel = 1;
	mapMaterial.map = map;
	for ( const material of pbrMaterials ) {

		material.lightMap = map;

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
