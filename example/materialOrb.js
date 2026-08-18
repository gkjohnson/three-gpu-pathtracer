import {
	ACESFilmicToneMapping,
	Color,
	Scene,
	WebGPURenderer,
	Vector3,
	RectAreaLightNode,
} from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { MaterialOrbSceneLoader } from './utils/MaterialOrbSceneLoader.js';

const DB_URL = 'https://api.physicallybased.info/v2/materials';
const CREDITS = 'Materials courtesy of "physicallybased.info"</br>Material orb model courtesy of USD Working Group';

// preset entry for hand edited values, ie. not one of the database materials
const CUSTOM_MATERIAL = 'Custom';

let pathTracer, renderer, controls, material;
let camera, scene, loader;
let gui, database, imgEl;

const _color = new Color();
const initialCameraPosition = new Vector3();
const initialCameraTarget = new Vector3();

const params = {

	material: CUSTOM_MATERIAL,

	materialProperties: {
		color: '#ffe6bd',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0,
		metalness: 1,
		ior: 1.495,
		transmission: 0.0,
		thinWall: false,
		attenuationColor: '#ffffff',
		attenuationDistance: 0.5,
		opacity: 1.0,
		clearcoat: 0.0,
		clearcoatRoughness: 0.0,
		sheenColor: '#000000',
		sheenRoughness: 0.0,
		iridescence: 0.0,
		iridescenceIOR: 1.5,
		iridescenceThickness: 400,
		specularColor: '#ffffff',
		specularIntensity: 1.0,
		anisotropy: 0.0,
		anisotropyRotation: 0.0,
		matte: false,
		flatShading: false,
		castShadow: true,
	},

	enable: true,
	displaySampleDensity: false,
	multipleImportanceSampling: true,
	bounces: 15,
	renderScale: 1,
	filterGlossyFactor: 1,
	tiles: 3,
};

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.renderScale *= 0.5;
	params.tiles = 2;
	params.multipleImportanceSampling = false;

}

init();

async function init() {

	RectAreaLightTexturesLib.init();
	RectAreaLightNode.setLTC( RectAreaLightTexturesLib );

	loader = new LoaderElement();
	loader.attach( document.body );

	// reference photo for the selected database material, hidden while editing by hand
	imgEl = document.getElementById( 'materialImage' );
	imgEl.style.display = 'none';

	// renderer
	renderer = new WebGPURenderer( { antialias: true, alpha: true } );
	renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.02;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );

	scene = new Scene();

	// load assets
	const [ orb, dbJson ] = await Promise.all( [
		new MaterialOrbSceneLoader().loadAsync(),
		fetch( DB_URL ).then( res => res.json() ),
	] );

	database = {};
	dbJson.data.forEach( mat => database[ mat.name ] = mat );

	// scene initialization
	scene.add( orb.scene );
	camera = orb.camera;
	material = orb.material;

	// the model ships without tangents, which anisotropy needs to orient its frame
	orb.scene.getObjectByName( 'material_surface' ).geometry.computeTangents();

	// move camera to the scene
	scene.attach( camera );
	camera.removeFromParent();

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );

	// shift target
	const fwd = new Vector3( 0, 0, - 1 ).transformDirection( camera.matrixWorld ).normalize();
	controls.target.copy( camera.position ).addScaledVector( fwd, 25 );
	controls.update();

	// the viewpoint authored in the model, restored by the reset button
	initialCameraPosition.copy( camera.position );
	initialCameraTarget.copy( controls.target );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	onParamsChange();
	pathTracer.setScene( scene, camera );
	onResize();
	window.addEventListener( 'resize', onResize );

	// gui
	gui = new GUI();
	gui.add( params, 'material', [ CUSTOM_MATERIAL, ...Object.keys( database ) ] ).onChange( onMaterialChange );
	gui.add( { resetCamera }, 'resetCamera' ).name( 'reset camera' );

	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'enable' );
	ptFolder.add( params, 'displaySampleDensity' );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 10 ).onChange( onParamsChange );
	ptFolder.add( params, 'bounces', 1, 50, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );
	ptFolder.close();

	const matFolder1 = gui.addFolder( 'Material Parameters' );
	matFolder1.addColor( params.materialProperties, 'color' ).onChange( onParamsChange );
	matFolder1.addColor( params.materialProperties, 'emissive' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'roughness', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'metalness', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'opacity', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'transmission', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'thinWall', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'attenuationDistance', 0.05, 2.0 ).onChange( onParamsChange );
	matFolder1.addColor( params.materialProperties, 'attenuationColor' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'ior', 0.9, 3.0 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'clearcoat', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'clearcoatRoughness', 0, 1 ).onChange( onParamsChange );
	matFolder1.addColor( params.materialProperties, 'sheenColor' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'sheenRoughness', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'iridescence', 0.0, 1.0 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'iridescenceIOR', 0.1, 3.0 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'iridescenceThickness', 0.0, 1200.0 ).onChange( onParamsChange );
	matFolder1.addColor( params.materialProperties, 'specularColor' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'specularIntensity', 0.0, 1.0 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'anisotropy', 0.0, 1.0 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'anisotropyRotation', 0.0, 2.0 * Math.PI ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'matte' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'flatShading' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'castShadow' ).onChange( onParamsChange );
	matFolder1.close();

	// editing anything by hand means the values no longer match the selected preset
	matFolder1.controllersRecursive().forEach( controller => {

		controller.onFinishChange( () => {

			params.material = CUSTOM_MATERIAL;
			imgEl.style.display = 'none';
			gui.controllers[ 0 ].updateDisplay();

		} );

	} );

	animate();

}

// copy a physicallybased.info entry into the material properties so the manual controls stay in
// sync and can be used to tweak the preset afterward
function applyDatabaseMaterial( info ) {

	const materialProperties = params.materialProperties;

	// the database only describes a subset of the material, so reset the rest to neutral
	materialProperties.color = '#ffffff';
	materialProperties.specularColor = '#ffffff';
	materialProperties.attenuationColor = '#ffffff';
	materialProperties.attenuationDistance = 1;
	materialProperties.metalness = 0;
	materialProperties.roughness = 1;
	materialProperties.ior = 1.5;
	materialProperties.transmission = 0;
	materialProperties.iridescence = 0;
	materialProperties.iridescenceIOR = 1;
	materialProperties.iridescenceThickness = 0;

	// database colors are linear, the gui works in hex so they round trip through sRGB
	const toHex = rgb => '#' + _color.setRGB( ...rgb ).getHexString();

	if ( info.specularColor ) materialProperties.specularColor = toHex( info.specularColor[ 0 ].color[ 0 ].color );
	if ( 'metalness' in info ) materialProperties.metalness = info.metalness;
	if ( 'roughness' in info ) materialProperties.roughness = info.roughness;
	if ( 'ior' in info ) materialProperties.ior = info.ior;
	if ( 'transmission' in info ) materialProperties.transmission = info.transmission;

	if ( 'thinFilmThickness' in info ) {

		materialProperties.iridescence = 1;
		materialProperties.iridescenceIOR = info.thinFilmIor;
		materialProperties.iridescenceThickness = info.thinFilmThickness[ 2 ] ?? info.thinFilmThickness[ 0 ];

	}

	// a transmissive material tints by attenuation rather than base color
	if ( materialProperties.transmission ) {

		if ( info.color ) materialProperties.attenuationColor = toHex( info.color[ 0 ].color );
		materialProperties.attenuationDistance = info.transmissionDepth ?? 1;

	} else if ( info.color ) {

		materialProperties.color = toHex( info.color[ 0 ].color );

	}

	imgEl.src = Object.values( info.images[ 1 ] )[ 0 ];

}

function onMaterialChange() {

	if ( params.material !== CUSTOM_MATERIAL ) {

		applyDatabaseMaterial( database[ params.material ] );

	}

	imgEl.style.display = params.material === CUSTOM_MATERIAL ? 'none' : '';

	gui.controllersRecursive().forEach( c => c.updateDisplay() );
	onParamsChange();

}

function resetCamera() {

	camera.position.copy( initialCameraPosition );
	controls.target.copy( initialCameraTarget );
	controls.update();
	pathTracer.updateCamera();

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	pathTracer.updateCamera();

}

function onParamsChange() {

	const materialProperties = params.materialProperties;
	material.color.set( materialProperties.color );
	material.emissive.set( materialProperties.emissive );
	material.emissiveIntensity = materialProperties.emissiveIntensity;
	material.metalness = materialProperties.metalness;
	material.roughness = materialProperties.roughness;
	material.transmission = materialProperties.transmission;
	material.attenuationDistance = materialProperties.thinWall ? Infinity : materialProperties.attenuationDistance;
	material.attenuationColor.set( materialProperties.attenuationColor );
	material.ior = materialProperties.ior;
	material.opacity = materialProperties.opacity;
	material.clearcoat = materialProperties.clearcoat;
	material.clearcoatRoughness = materialProperties.clearcoatRoughness;
	material.sheenColor.set( materialProperties.sheenColor );
	material.sheenRoughness = materialProperties.sheenRoughness;
	material.iridescence = materialProperties.iridescence;
	material.iridescenceIOR = materialProperties.iridescenceIOR;
	material.iridescenceThicknessRange = [ 0, materialProperties.iridescenceThickness ];
	material.specularColor.set( materialProperties.specularColor );
	material.specularIntensity = materialProperties.specularIntensity;
	material.anisotropy = materialProperties.anisotropy;
	material.anisotropyRotation = materialProperties.anisotropyRotation;
	material.transparent = material.opacity < 1;
	material.flatShading = materialProperties.flatShading;

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	// note: custom properties
	material.matte = materialProperties.matte;
	material.castShadow = materialProperties.castShadow;

	pathTracer.updateMaterials();

}

function animate() {

	requestAnimationFrame( animate );

	if ( params.enable ) {

		pathTracer.renderSample();

		if ( params.displaySampleDensity ) {

			pathTracer.renderSampleDensity();

		}

	} else {

		renderer.render( scene, camera );

	}

}
