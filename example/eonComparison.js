import {
	Box3,
	Color,
	Mesh,
	MeshBasicNodeMaterial,
	MeshPhysicalMaterial,
	NoToneMapping,
	OrthographicCamera,
	PerspectiveCamera,
	PlaneGeometry,
	RenderTarget,
	RGBAFormat,
	FloatType,
	Scene,
	Vector3,
	WebGPURenderer,
} from 'three/webgpu';
import { texture } from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { GltfCompliantMaterial } from '../src/webgpu/materials/GltfCompliantMaterial.js';
import { eonBrdfFunc, fonBrdfFunc } from '../src/webgpu/nodes/eon.wgsl.js';
import { lambertBrdfFunc } from '../src/webgpu/nodes/material.wgsl.js';
import { ProceduralEquirectTexture } from '../src/textures/ProceduralEquirectTexture.js';

const MODEL_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/USDShaderBallForGltf/glTF-Binary/USDShaderBallForGltf.glb';

// Comparison layout follows the front-lit and side-lit scenes in the EON paper.
const ALGORITHMS = [
	{ diffuseBrdf: lambertBrdfFunc },
	{ diffuseBrdf: fonBrdfFunc },
	{ diffuseBrdf: eonBrdfFunc },
];

const params = {
	diffuseRoughness: 1.0,
	lightAngle: 75,
	albedo: '#e0e0e0',
};

const lightingRows = [
	{ angle: 0 },
	{ angle: params.lightAngle },
];

let renderer;
let camera;
let scene;
let material;
let environment;
let pathTracers;
let renderTargets;
let compositeScene;
let compositeCamera;
let stage;
let sampleReadout;

init();

async function init() {

	stage = document.getElementById( 'stage' );
	sampleReadout = document.getElementById( 'samples' );

	renderer = new WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.toneMapping = NoToneMapping;
	renderer.setClearColor( 0x101216, 1 );
	renderer.domElement.className = 'comparison-canvas';
	stage.appendChild( renderer.domElement );

	scene = new Scene();
	scene.background = new Color( 0x101216 );
	scene.environmentIntensity = 3;
	scene.backgroundIntensity = 0;

	const environmentDirection = new Vector3();
	const sunDirection = new Vector3( 0, 0, 1 );
	environment = new ProceduralEquirectTexture( 256, 128 );
	environment.generationCallback = function ( polar ) {

		const color = arguments[ 3 ];
		environmentDirection.setFromSpherical( polar );
		const sun = Math.max( 0, ( environmentDirection.dot( sunDirection ) - 0.9 ) / 0.1 );
		const value = 0.04 + 20 * sun * sun;

		color.setRGB( value, value * 0.96, value * 0.9 );

	};

	environment.update();
	scene.environment = environment;

	camera = new PerspectiveCamera( 40, 1, 0.1, 100 );
	camera.position.set( 0, 0.08, 3.25 );
	camera.lookAt( 0, 0, 0 );

	material = new MeshPhysicalMaterial( {
		color: new Color( 0.48, 0.48, 0.48 ),
		metalness: 0,
		roughness: 1,
		ior: 1,
		transmission: 0,
		specularIntensity: 0,
	} );
	material.color.set( params.albedo ).convertSRGBToLinear();
	material.diffuseRoughness = params.diffuseRoughness;

	const gltf = await new GLTFLoader().loadAsync( MODEL_URL );
	prepareModel( gltf.scene );
	scene.add( gltf.scene );

	pathTracers = [];
	for ( const lighting of lightingRows ) {

		for ( const algorithm of ALGORITHMS ) {

			const pathTracer = new WebGPUPathTracer( renderer );
			pathTracer.synchronizeRenderSize = false;
			pathTracer.dynamicLowRes = false;
			pathTracer.renderDelay = 0;
			pathTracer.setMaterial( new GltfCompliantMaterial( { diffuseBrdf: algorithm.diffuseBrdf } ) );
			scene.environmentRotation.y = lighting.angle * Math.PI / 180;
			pathTracer.setScene( scene, camera );
			pathTracers.push( pathTracer );

		}

	}

	// Keep each algorithm and lighting condition's accumulated image separate before compositing.
	renderTargets = pathTracers.map( () => new RenderTarget( 1, 1, {
		type: FloatType,
		format: RGBAFormat,
		depthBuffer: false,
	} ) );
	compositeScene = new Scene();
	compositeCamera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
	for ( let i = 0; i < renderTargets.length; i ++ ) {

		const panelMaterial = new MeshBasicNodeMaterial( { toneMapped: false } );
		panelMaterial.colorNode = texture( renderTargets[ i ].texture );
		const panel = new Mesh( new PlaneGeometry( 2 / ALGORITHMS.length, 1 ), panelMaterial );
		const column = i % ALGORITHMS.length;
		const row = Math.floor( i / ALGORITHMS.length );
		panel.position.x = ( column + 0.5 ) * 2 / ALGORITHMS.length - 1;
		panel.position.y = 0.5 - row;
		compositeScene.add( panel );

	}

	bindControls();
	onResize();
	window.addEventListener( 'resize', onResize );
	requestAnimationFrame( animate );

}

function prepareModel( model ) {

	const bounds = new Box3().setFromObject( model );
	const size = bounds.getSize( new Vector3() );
	const center = bounds.getCenter( new Vector3() );
	const scale = 2.0 / Math.max( size.x, size.y, size.z );

	model.scale.setScalar( scale );
	model.rotation.set( Math.PI, Math.PI, 0 );
	model.position.copy( center ).multiplyScalar( scale );

	model.updateMatrixWorld( true );

	model.traverse( child => {

		if ( child.isMesh ) {

			// Use one neutral material so every panel measures only the diffuse BRDF.
			child.material = material;

		}

	} );

}

function bindControls() {

	const roughnessInput = document.getElementById( 'diffuse-roughness' );
	const roughnessValue = document.getElementById( 'diffuse-roughness-value' );
	roughnessInput.value = params.diffuseRoughness;
	roughnessInput.addEventListener( 'input', () => {

		params.diffuseRoughness = Number( roughnessInput.value );
		roughnessValue.textContent = params.diffuseRoughness.toFixed( 2 );
		material.diffuseRoughness = params.diffuseRoughness;
		pathTracers.forEach( pathTracer => pathTracer.updateMaterials() );

	} );

	const angleInput = document.getElementById( 'light-angle' );
	const angleValue = document.getElementById( 'light-angle-value' );
	angleInput.value = params.lightAngle;
	angleInput.addEventListener( 'input', () => {

		params.lightAngle = Number( angleInput.value );
		angleValue.textContent = `${ params.lightAngle } deg`;

	} );
	angleInput.addEventListener( 'change', () => {

		lightingRows[ 1 ].angle = params.lightAngle;
		updateEnvironmentRotation();

	} );

	const albedoInput = document.getElementById( 'albedo' );
	albedoInput.value = params.albedo;
	albedoInput.addEventListener( 'input', () => {

		params.albedo = albedoInput.value;
		material.color.set( params.albedo ).convertSRGBToLinear();
		pathTracers.forEach( pathTracer => pathTracer.updateMaterials() );

	} );

}

function updateEnvironmentRotation() {

	let index = 0;
	for ( const lighting of lightingRows ) {

		scene.environmentRotation.y = lighting.angle * Math.PI / 180;
		for ( let i = 0; i < ALGORITHMS.length; i ++ ) {

			pathTracers[ index ++ ].updateEnvironment();

		}

	}

}

function onResize() {

	const width = stage.clientWidth;
	const height = stage.clientHeight;
	const pixelRatio = Math.min( window.devicePixelRatio, 2 );
	const panelWidth = width / ALGORITHMS.length;
	const panelHeight = height / lightingRows.length;

	renderer.setPixelRatio( pixelRatio );
	renderer.setSize( width, height, false );
	camera.aspect = panelWidth / panelHeight;
	camera.updateProjectionMatrix();

	for ( let i = 0; i < pathTracers.length; i ++ ) {

		const pathTracer = pathTracers[ i ];
		const sampleWidth = Math.max( 1, Math.floor( panelWidth * pixelRatio * pathTracer.renderScale ) );
		const sampleHeight = Math.max( 1, Math.floor( panelHeight * pixelRatio * pathTracer.renderScale ) );
		pathTracer.setSize( sampleWidth, sampleHeight );
		renderTargets[ i ].setSize( sampleWidth, sampleHeight );
		pathTracer.updateCamera();

	}

}

function animate() {

	requestAnimationFrame( animate );

	const width = stage.clientWidth;
	const height = stage.clientHeight;
	let totalSamples = Infinity;

	for ( let i = 0; i < pathTracers.length; i ++ ) {

		const renderTarget = renderTargets[ i ];
		renderer.setRenderTarget( renderTarget );
		renderer.setViewport( 0, 0, renderTarget.width, renderTarget.height );
		const pathTracer = pathTracers[ i ];
		pathTracer.renderSample();
		totalSamples = Math.min( totalSamples, pathTracer.samples );

	}

	renderer.setRenderTarget( null );
	renderer.setViewport( 0, 0, width, height );
	renderer.render( compositeScene, compositeCamera );

	sampleReadout.textContent = `${ totalSamples } spp`;

}
