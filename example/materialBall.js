import {
	ACESFilmicToneMapping,
	CustomBlending,
	Scene,
	WebGLRenderer,
	Vector3,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DenoiseMaterial, WebGLPathTracer } from '../src/index.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { MaterialOrbSceneLoader } from './utils/MaterialOrbSceneLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

const CREDITS = 'Material orb model courtesy of USD Working Group';

let pathTracer, renderer, controls, denoiseQuad, material;
let camera, scene, loader;

const params = {

	materialProperties: {
		color: '#ffe6bd',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0,
		metalness: 1,
		ior: 1.495,
		transmission: 0.0,
		thinFilm: false,
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
		matte: false,
		flatShading: false,
		castShadow: true,
	},

	multipleImportanceSampling: true,
	denoiseEnabled: true,
	denoiseSigma: 2.5,
	denoiseThreshold: 0.1,
	denoiseKSigma: 1.0,
	bounces: 5,
	renderScale: 1 / window.devicePixelRatio,
	transmissiveBounces: 20,
	filterGlossyFactor: 0.5,
	tiles: 3,
};

if ( window.location.hash.includes( 'transmission' ) ) {

	params.materialProperties.metalness = 0.0;
	params.materialProperties.roughness = 0.23;
	params.materialProperties.transmission = 1.0;
	params.materialProperties.color = '#ffffff';

	params.bounces = 10;
	params.tiles = 2;

} else if ( window.location.hash.includes( 'iridescent' ) ) {

	params.materialProperties.color = '#474747';
	params.materialProperties.roughness = 0.25;
	params.materialProperties.metalness = 1.0;
	params.materialProperties.iridescence = 1.0;
	params.materialProperties.iridescenceIOR = 2.2;

} else if ( window.location.hash.includes( 'acrylic' ) ) {

	params.materialProperties.color = '#ffffff';
	params.materialProperties.roughness = 0;
	params.materialProperties.metalness = 0;
	params.materialProperties.transmission = 1.0;
	params.materialProperties.attenuationDistance = 0.75;
	params.materialProperties.attenuationColor = '#2a6dc6';

	params.bounces = 20;
	params.tiles = 3;

}

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.max( params.bounces, 6 );
	params.renderScale *= 0.5;
	params.tiles = 2;
	params.multipleImportanceSampling = false;

}

init();

async function init() {

	RectAreaLightUniformsLib.init();

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.02;
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.textureSize.set( 2048, 2048 );
	pathTracer.renderToCanvasCallback = ( target, renderer, quad ) => {

		denoiseQuad.material.sigma = params.denoiseSigma;
		denoiseQuad.material.threshold = params.denoiseThreshold;
		denoiseQuad.material.kSigma = params.denoiseKSigma;
		denoiseQuad.material.opacity = quad.material.opacity;

		const autoClear = renderer.autoClear;
		const finalQuad = params.denoiseEnabled ? denoiseQuad : quad;
		renderer.autoClear = false;
		finalQuad.material.map = target.texture;
		finalQuad.render( renderer );
		renderer.autoClear = autoClear;

	};

	// denoiser
	denoiseQuad = new FullScreenQuad( new DenoiseMaterial( {
		map: null,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	scene = new Scene();

	window.SCENE = scene;

	// load assets
	const orb = await new MaterialOrbSceneLoader().loadAsync();

	// scene initialization
	scene.add( orb.scene );
	camera = orb.camera;
	material = orb.material;

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

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );

	onParamsChange();
	onResize();
	window.addEventListener( 'resize', onResize );

	// gui
	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracer' );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( onParamsChange );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'transmissiveBounces', 0, 40, 1 ).onChange( onParamsChange );
	ptFolder.add( params, 'renderScale', 0.1, 1 ).onChange( onParamsChange );

	const denoiseFolder = gui.addFolder( 'Denoising' );
	denoiseFolder.add( params, 'denoiseEnabled' );
	denoiseFolder.add( params, 'denoiseSigma', 0.01, 12.0 );
	denoiseFolder.add( params, 'denoiseThreshold', 0.01, 1.0 );
	denoiseFolder.add( params, 'denoiseKSigma', 0.0, 12.0 );
	denoiseFolder.close();

	const matFolder1 = gui.addFolder( 'Material' );
	matFolder1.addColor( params.materialProperties, 'color' ).onChange( onParamsChange );
	matFolder1.addColor( params.materialProperties, 'emissive' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'roughness', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'metalness', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'opacity', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'transmission', 0, 1 ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'thinFilm', 0, 1 ).onChange( onParamsChange );
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
	matFolder1.add( params.materialProperties, 'matte' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'flatShading' ).onChange( onParamsChange );
	matFolder1.add( params.materialProperties, 'castShadow' ).onChange( onParamsChange );
	matFolder1.close();

	animate();

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
	material.attenuationDistance = materialProperties.thinFilm ? Infinity : materialProperties.attenuationDistance;
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
	material.transparent = material.opacity < 1;
	material.flatShading = materialProperties.flatShading;

	pathTracer.transmissiveBounces = params.transmissiveBounces;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.renderScale;

	// note: custom properties
	material.matte = materialProperties.matte;
	material.castShadow = materialProperties.castShadow;

	pathTracer.updateMaterials();
	pathTracer.setScene( scene, camera );

}

function animate() {

	requestAnimationFrame( animate );
	pathTracer.renderSample();
	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
