import {
	ACESFilmicToneMapping,
	Box3,
	Color,
	DoubleSide,
	EquirectangularReflectionMapping,
	HalfFloatType,
	MathUtils,
	EnvironmentNode,
	Mesh,
	MeshBasicMaterial,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	QuadMesh,
	RenderTarget,
	Scene,
	Sphere,
	Texture,
	Vector3,
	WebGPURenderer,
} from 'three/webgpu';
import { texture, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { unwrapUVs } from 'three/examples/jsm/utils/unwrapUVs.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './src/LoaderElement.js';
import { SkyTexture } from './src/SkyTexture.js';
import { UVUnwrapper } from './src/libs/UVUnwrapper.js';
import { GutterFillGenerator } from './src/libs/GutterFillGenerator.js';
import { SeamStitchGenerator } from './src/libs/SeamStitchGenerator.js';
import {
	WebGPUPathTracer,
	OIDNDenoiser,
	AOMapCamera,
	AOMapShadingModel,
	LightmapCamera,
	LightmapShadingModel,
} from 'three-gpu-pathtracer/webgpu';
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

const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/kitchen-room/kitchen-room.glb';
const VIEW_ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';
const WEIGHTS_AUX_URL = new URL( './src/denoise/rt_hdr_alb_nrm.tza', import.meta.url ).toString();
const WEIGHTS_COLOR_URL = new URL( './src/denoise/rt_hdr.tza', import.meta.url ).toString();
const CREDITS = 'Kitchen model by "leha_pu" on Sketchfab, CC-BY-4.0';
const DESCRIPTIONS = {
	'lightmap': 'Irradiance baked into a uv atlas and applied as a lightmap.',
	'ao map': 'Ambient occlusion baked into a uv atlas and applied as an ao map.',
};

const MAP_SIZE = 1024;
const MAX_SAMPLES = 16;

// occluders further than this, in world units, don't count toward the ao
const AO_RADIUS = 0.5;

// the sky's brightness in the lightmap
const SKY_INTENSITY = 5;

// the angular radius of the sky's sun disc in degrees
const SUN_DISC_RADIUS = 0.53;

const params = {
	map: 'lightmap',
	view: 'pbr',
	unwrapper: 'xatlas',
	// TODO: start in daylight once a radiance cache makes the sunlit bake converge faster
	sunElevation: 0,
	ceilingLight: true,
	cabinetLights: true,
	resolution: MAP_SIZE,
	regenerate: () => pathTracer.reset(),
};

let renderer, pathTracer, camera, scene, loader;
let model, gutterFill, seamStitch, stitchedMap, finishedMap, mapNode, textureQuad;
let filledColor, filledAlbedo, filledNormal;
let pbrModel, pbrMeshes, mapMaterial, viewEnvironment;
let bakeScene, bakeModes;

// the sky lighting the kitchen, for the sun's elevation
const sky = new SkyTexture();

// the map as it bakes, faded in over the low res preview
const bakeTarget = new RenderTarget( 1, 1, { type: HalfFloatType, depthBuffer: false } );

const roomLights = [];
const sourceGeometries = new Map();

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

	// the kitchen, lit by the sky for the sun's elevation
	sky.skyNode.sunPosition.value.copy( getSunDirection( params.sunElevation ) );
	sky.update( renderer );
	const [ gltf ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		new HDRLoader().loadAsync( VIEW_ENV_URL ).then( texture => {

			texture.mapping = EquirectangularReflectionMapping;
			viewEnvironment = texture;

		} ),
	] );

	// the kitchen in its room
	model = gltf.scene;
	model.updateMatrixWorld( true );

	const bounds = new Box3().setFromObject( model );
	const { center, radius } = bounds.getBoundingSphere( new Sphere() );

	// bake every surface double sided so rays can't pass through the back of one, except the room's walls and window
	// frame, which stay one sided so the views see in. The source geometries are kept to unwrap again
	model.traverse( c => {

		if ( ! c.isMesh ) {

			return;

		}

		sourceGeometries.set( c, c.geometry );
		if ( c.name !== 'Room' && c.name !== 'WindowFrame' ) {

			c.material.side = DoubleSide;

		}

	} );

	// each light is named by the param that turns it on
	const ceilingLight = createCeilingLight( bounds );
	ceilingLight.userData.toggle = 'ceilingLight';
	const cabinetLights = createCabinetLights( bounds );
	cabinetLights.forEach( light => light.userData.toggle = 'cabinetLights' );
	roomLights.push( ceilingLight, ...cabinetLights );

	// unwrap the meshes into one atlas, packing their own uv charts
	await unwrap();

	// the view: a copy of the model with its own materials, lit by the lightmap, using the ao map, or shaded by the
	// map alone
	mapMaterial = new MeshBasicMaterial();
	pbrModel = model.clone();
	pbrMeshes = [];
	pbrModel.traverse( c => {

		if ( c.isMesh ) {

			pbrMeshes.push( {
				mesh: c,
				lightmapMaterial: new LightmapViewMaterial().copy( c.material ),
				aoMaterial: c.material.clone(),
				originalMaterial: c.material.clone(),
			} );

		}

	} );

	scene = new Scene();
	// the views have no environment, since the walls hide the sky and the lightmap holds all of the room's light
	// TODO: reflections need a probe captured inside the room, and specular occlusion
	scene.add( pbrModel );

	// unlit copies of the room's light panels in the views, which get their light from the lightmap
	for ( const light of roomLights ) {

		const panel = new Mesh( light.geometry, new MeshBasicMaterial( { color: light.material.emissive } ) );
		panel.position.copy( light.position );
		panel.rotation.copy( light.rotation );
		scene.add( panel );
		light.userData.panel = panel;
		light.userData.intensity = light.material.emissiveIntensity;

	}

	// the bake scene, its background set by the map being baked
	bakeScene = new Scene();
	bakeScene.add( model );

	// the room's emissive light panels only light the bake
	roomLights.forEach( light => bakeScene.add( light ) );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.synchronizeRenderSize = false;
	pathTracer.renderToCanvas = false;
	pathTracer.maxSamples = MAX_SAMPLES;
	pathTracer.minSamples = 0;
	pathTracer.fadeDuration = 0;

	pathTracer.addEventListener( 'progress', ( { stage, progress, samples } ) => {

		loader.setStage( stage, progress, samples );

	} );

	// the gutter fill and seam stitch read the charts' coverage from the map's alpha
	gutterFill = new GutterFillGenerator( renderer );
	seamStitch = new SeamStitchGenerator( renderer );
	seamStitch.setGeometry( model );

	// what each map bakes with: a camera that lands each ray on a texel of the atlas, the shading model at the
	// texel, the scene's background, the clamps and a denoiser. The finished map, and the lightmap's albedo and
	// normal guides, get their gutters filled before the denoise so chart edges don't blur into empty texels
	// TODO: try a port of three.js' LightMapDenoiser ( mrdoob/three.js#35302 ) through "setDenoiser"
	bakeModes = {

		// the texel's white lambertian gathers the light arriving there, its irradiance. Paths carry PI times
		// the throughput of a render, so the display tuned clamps would cut the bounced light
		'lightmap': {
			camera: new LightmapCamera( model ),
			shadingModel: new LightmapShadingModel(),
			background: sky.texture,
			environment: sky.texture,
			environmentIntensity: SKY_INTENSITY,
			clamp: 0,
			denoiser: new OIDNDenoiser( {
				initUNetFromURL,
				auxWeightsUrl: WEIGHTS_AUX_URL,
				onBeforeDenoise: ( color, albedo, normal ) => {

					filledColor = gutterFill.generate( color, filledColor );
					filledAlbedo = gutterFill.generate( albedo, filledAlbedo );
					filledNormal = gutterFill.generate( normal, filledNormal );
					return {
						color: filledColor.texture,
						albedo: filledAlbedo.texture,
						normal: filledNormal.texture,
					};

				},
			} ),
		},

		// a ray that escapes reads the white sky. The rays leave the texel, so the albedo and normal guides
		// would show the occluders
		'ao map': {
			camera: new AOMapCamera( model ),
			shadingModel: new AOMapShadingModel( { radius: AO_RADIUS } ),
			background: new Color( 0xffffff ),
			environment: null,
			environmentIntensity: 1,
			clamp: pathTracer.clampDirect,
			denoiser: new OIDNDenoiser( {
				initUNetFromURL,
				colorWeightsUrl: WEIGHTS_COLOR_URL,
				useAuxiliaryBuffers: false,
				onBeforeDenoise: color => {

					filledColor = gutterFill.generate( color, filledColor );
					return { color: filledColor.texture };

				},
			} ),
		},

	};

	// shows the stitched map once the bake and its denoise finish
	pathTracer.addEventListener( 'complete', () => {

		const { denoiser } = bakeModes[ params.map ];
		stitchedMap = seamStitch.generate( denoiser.texture, stitchedMap );
		finishedMap = gutterFill.generate( stitchedMap.texture, finishedMap );
		setMap( finishedMap.texture );

	} );

	pathTracer.setSize( params.resolution, params.resolution );
	updateRoomLights();
	onMapChange();

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
	const viewFolder = gui.addFolder( 'View' );
	viewFolder.add( params, 'view', {
		'With Map': 'pbr',
		'Original': 'original',
		'Map Only': 'map',
		'Atlas': 'texture',
	} ).onChange( updateViewMaterials );

	const bakeFolder = gui.addFolder( 'Bake' );
	bakeFolder.add( params, 'map', { 'Lightmap': 'lightmap', 'AO Map': 'ao map' } ).onChange( onMapChange );
	bakeFolder.add( params, 'resolution', [ 128, 256, 512, 1024, 2048, 4096 ] ).onChange( size => pathTracer.setSize( size, size ) );
	bakeFolder.add( pathTracer, 'maxSamples', 1, 100, 1 );
	bakeFolder.add( pathTracer, 'maxBounces', 1, 20, 1 );
	bakeFolder.add( params, 'unwrapper', [ 'three.js', 'xatlas' ] ).onChange( onUnwrapperChange );
	bakeFolder.add( params, 'regenerate' );

	const lightingFolder = gui.addFolder( 'Lighting' );
	lightingFolder.add( params, 'sunElevation', 0, 90 ).onChange( onSunElevationChange );
	lightingFolder.add( params, 'ceilingLight' ).onChange( updateRoomLights );
	lightingFolder.add( params, 'cabinetLights' ).onChange( updateRoomLights );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

// bakes the selected map, and shows the view materials that use it
function onMapChange() {

	const mode = bakeModes[ params.map ];
	bakeScene.background = mode.background;
	bakeScene.environment = mode.environment;
	bakeScene.environmentIntensity = mode.environmentIntensity;
	pathTracer.clampDirect = mode.clamp;
	pathTracer.clampIndirect = mode.clamp;
	pathTracer.setShadingModel( mode.shadingModel );
	pathTracer.setDenoiser( mode.denoiser );
	pathTracer.setScene( bakeScene, mode.camera );

	updateViewMaterials();

	loader.setDescription( DESCRIPTIONS[ params.map ] );

}

// the pbr view uses the materials for the baked map, the original view the model's materials without it, and the
// map view the map alone
function updateViewMaterials() {

	for ( const { mesh, lightmapMaterial, aoMaterial, originalMaterial } of pbrMeshes ) {

		if ( params.view === 'map' ) {

			mesh.material = mapMaterial;

		} else if ( params.view === 'original' ) {

			mesh.material = originalMaterial;

		} else {

			mesh.material = params.map === 'lightmap' ? lightmapMaterial : aoMaterial;

		}

	}

	// the lightmap holds all of the room's light, while the ao map and the original materials are lit by an hdr,
	// the ao map darkening it
	scene.environment = params.view === 'original' || params.map === 'ao map' ? viewEnvironment : null;

}

// unwraps the meshes into one atlas with the selected unwrapper, packing their own uv charts. Each mesh
// starts again from its source geometry
async function unwrap() {

	sourceGeometries.forEach( ( geometry, mesh ) => {

		mesh.geometry = geometry;

	} );

	if ( params.unwrapper === 'xatlas' ) {

		const unwrapper = new UVUnwrapper();
		unwrapper.resolution = MAP_SIZE;
		unwrapper.useInputUVs = true;
		await unwrapper.generate( model );

	} else if ( unwrapUVs( model, { resolution: MAP_SIZE, useInputUVs: true } ) === null ) {

		throw new Error( 'unwrapUVs: The charts do not fit the atlas.' );

	}

}

// unwraps again with the selected unwrapper and bakes the new atlas
async function onUnwrapperChange() {

	const meshes = [ ...sourceGeometries.keys() ];
	const previous = meshes.map( mesh => mesh.geometry );
	await unwrap();
	previous.forEach( geometry => geometry.dispose() );

	// the view shares the model's geometries
	pbrMeshes.forEach( ( { mesh }, i ) => {

		mesh.geometry = meshes[ i ].geometry;

	} );

	pathTracer.setScene( bakeScene, bakeModes[ params.map ].camera );
	seamStitch.setGeometry( model );

}

// the direction toward the sun at the given elevation in degrees, from the west-southwest so it shines through the
// window. At 0 the sun's disc is just below the horizon
function getSunDirection( degrees ) {

	const azimuth = MathUtils.degToRad( 157.5 );
	const elevation = MathUtils.degToRad( degrees - SUN_DISC_RADIUS );
	return new Vector3(
		Math.cos( azimuth ) * Math.cos( elevation ),
		Math.sin( elevation ),
		Math.sin( azimuth ) * Math.cos( elevation ),
	);

}

// renders the sky for the sun's elevation, baked into the lightmap
function onSunElevationChange() {

	sky.skyNode.sunPosition.value.copy( getSunDirection( params.sunElevation ) );
	sky.update( renderer );
	if ( params.map === 'lightmap' ) {

		pathTracer.updateEnvironment();

	}

}

// turns the room's lights on or off, and shows their panels while they're on
function updateRoomLights() {

	for ( const light of roomLights ) {

		const on = params[ light.userData.toggle ];
		light.material.emissiveIntensity = on ? light.userData.intensity : 0;
		light.userData.panel.visible = on;

	}

	pathTracer.updateMaterials();

}

// light strips under the two runs of upper cabinets, either side of the hood, near their front edges. Measured
// from the scaled kitchen, relative to its bounds: the undersides are 1.4746 m up, from 0.06 to 0.49 m from the back
function createCabinetLights( bounds ) {

	const { min } = bounds;
	const runs = [
		[ 0.06, 1.21 ],
		[ 1.79, 2.33 ],
	];
	return runs.map( ( [ start, end ] ) => {

		const light = createLightPanel( 0xffeedd, 30, end - start - 0.04, 0.08 );
		light.position.set( min.x + ( start + end ) / 2, min.y + 1.4746 - 0.005, min.z + 0.42 );
		light.updateMatrixWorld( true );
		return light;

	} );

}

// a small square light panel in the middle of the ceiling, just under it
function createCeilingLight( bounds ) {

	const center = bounds.getCenter( new Vector3() );
	const light = createLightPanel( 0xfff4e6, 360, 0.2, 0.2 );
	light.position.set( center.x, bounds.max.y - 0.005, center.z );
	light.updateMatrixWorld( true );
	return light;

}

// a black, one sided emissive panel facing down, sampled as a light by the path tracer
function createLightPanel( color, intensity, width, height ) {

	const material = new MeshStandardMaterial( { color: 0x000000, emissive: color, emissiveIntensity: intensity } );
	const panel = new Mesh( new PlaneGeometry( width, height ), material );
	panel.rotation.x = Math.PI / 2;
	return panel;

}

function setMap( map ) {

	map.channel = 1;
	mapMaterial.map = map;
	for ( const { lightmapMaterial, aoMaterial } of pbrMeshes ) {

		if ( params.map === 'lightmap' ) {

			lightmapMaterial.lightMap = map;

		} else {

			aoMaterial.aoMap = map;

		}

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

	// shows the map as it bakes, until the finished map replaces it
	if ( ! pathTracer.complete ) {

		pathTracer.renderTo( bakeTarget );
		setMap( bakeTarget.texture );

	}

	if ( params.view === 'texture' ) {

		renderTexture( mapMaterial.map );

	} else {

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
