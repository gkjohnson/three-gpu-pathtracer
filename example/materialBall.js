import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera, BlurredEnvMapGenerator, EquirectCamera, DenoiseMaterial } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TemporalResolve } from '../src/temporal-resolve/TemporalResolve.js';

let renderer, controls, sceneInfo, ptRenderer, activeCamera, blitQuad, denoiseQuad, materials, temporalResolve;
let perspectiveCamera, orthoCamera, equirectCamera;
let envMap, envMapGenerator, scene;
let samplesEl;

const orthoWidth = 5;

const params = {

	material1: {
		color: '#ffc766',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0.1,
		metalness: 0.8,
		ior: 1.495,
		transmission: 0.0,
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
		castShadow: true,
	},
	material2: {
		color: '#db7157',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0.8,
		metalness: 0.1,
		transmission: 0.0,
		ior: 1.495,
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
		castShadow: true,
	},
	material3: {
		color: '#000000',
		roughness: 0.01,
		metalness: 0.05,
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
		castShadow: true,
	},
	multipleImportanceSampling: true,
	stableNoise: false,
	denoiseEnabled: true,
	denoiseSigma: 2.5,
	denoiseThreshold: 0.1,
	denoiseKSigma: 1.0,
	environmentIntensity: 1,
	environmentRotation: 0,
	environmentBlur: 0.0,
	backgroundBlur: 0.0,
	bounces: 5,
	samplesPerFrame: 1,
	acesToneMapping: true,
	resolutionScale: 1 / window.devicePixelRatio,
	temporalResolve: true,
	temporalResolveMix: 0.9,
	clampRadius: 2,
	newSamplesSmoothing: 0.675,
	newSamplesCorrection: 1,
	weightTransform: 0,
	transparentTraversals: 20,
	filterGlossyFactor: 0.5,
	tiles: 1,
	backgroundAlpha: 1,
	checkerboardTransparency: true,
	cameraProjection: 'Perspective',
};

if ( window.location.hash.includes( 'transmission' ) ) {

	params.material1.metalness = 0.0;
	params.material1.roughness = 0.05;
	params.material1.transmission = 1.0;
	params.material1.color = '#ffffff';
	params.bounces = 10;

}

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.max( params.bounces, 6 );
	params.resolutionScale *= 0.5;
	params.tiles = 2;
	params.multipleImportanceSampling = false;
	params.environmentBlur = 0.35;

}

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.setClearColor( 0, 0 );
	document.body.appendChild( renderer.domElement );

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 4, 2, 7 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new THREE.OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.set( - 4, 2, 3 );

	equirectCamera = new EquirectCamera();
	equirectCamera.position.set( - 4, 2, 3 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.setDefine( 'TRANSPARENT_TRAVERSALS', params.transparentTraversals );
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.tiles.set( params.tiles, params.tiles );

	blitQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: THREE.CustomBlending,
	} ) );

	denoiseQuad = new FullScreenQuad( new DenoiseMaterial( {
		map: ptRenderer.target.texture,
		blending: THREE.CustomBlending,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	scene = new THREE.Scene();

	temporalResolve = new TemporalResolve( ptRenderer, scene, activeCamera );
	temporalResolve.temporalResolveMix = 0.9;
	temporalResolve.clampRadius = 2;
	temporalResolve.newSamplesSmoothing = 0.675;
	temporalResolve.newSamplesCorrection = 1;
	temporalResolve.weightTransform = 0;

	samplesEl = document.getElementById( 'samples' );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const envMapPromise = new Promise( resolve => {

		new RGBELoader()
			.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

				envMap = texture;

				updateEnvBlur();
				resolve();

			} );

	} );

	const generator = new PathTracingSceneWorker();
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/material-balls/material_ball_v2.glb' )
		.then( gltf => {

			const group = new THREE.Group();

			gltf.scene.scale.setScalar( 0.01 );
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			const floor = new THREE.Mesh(
				new THREE.CylinderBufferGeometry( 3, 3, 0.05, 200 ),
				new THREE.MeshPhysicalMaterial( { color: 0xffffff, roughness: 0, metalness: 0.25 } ),
			);
			floor.geometry = floor.geometry.toNonIndexed();
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.03;
			group.add( floor );

			const material1 = new THREE.MeshPhysicalMaterial();
			const material2 = new THREE.MeshPhysicalMaterial();

			gltf.scene.traverse( c => {

				// the vertex normals on the material ball are off...
				// TODO: precompute the vertex normals so they are correct on load
				if ( c.geometry ) {

					c.geometry.computeVertexNormals();

				}

				if ( c.name === 'Sphere_1' ) {

					c.material = material2;

				} else {

					c.material = material1;

				}

				if ( c.name === 'subsphere_1' ) {

					c.material = material2;

				}

			} );

			materials = [ material1, material2, floor.material ];

			return generator.generate( group );

		} )
		.then( result => {

			sceneInfo = result;

			scene.add( result.scene );

			const { bvh, textures, materials } = result;
			const geometry = bvh.geometry;
			const material = ptRenderer.material;

			material.bvh.updateFrom( bvh );
			material.normalAttribute.updateFrom( geometry.attributes.normal );
			material.tangentAttribute.updateFrom( geometry.attributes.tangent );
			material.uvAttribute.updateFrom( geometry.attributes.uv );
			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
			material.textures.setTextures( renderer, 2048, 2048, textures );
			material.materials.updateFrom( materials, textures );

			generator.dispose();

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );

	document.getElementById( 'loading' ).remove();
	document.body.classList.add( 'checkerboard' );

	onResize();
	window.addEventListener( 'resize', onResize );
	const gui = new GUI();

	updateCamera( params.cameraProjection );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'acesToneMapping' ).onChange( value => {

		renderer.toneMapping = value ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
		blitQuad.material.needsUpdate = true;

	} );
	ptFolder.add( params, 'stableNoise' ).onChange( value => {

		ptRenderer.stableNoise = value;

	} );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( value => {

		ptRenderer.material.setDefine( 'FEATURE_MIS', Number( value ) );
		ptRenderer.reset();

	} );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'transparentTraversals', 0, 40, 1 ).onChange( value => {

		ptRenderer.material.setDefine( 'TRANSPARENT_TRAVERSALS', value );
		ptRenderer.reset();

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const trFolder = gui.addFolder( 'Temporal Resolve' );
	trFolder.add( params, 'temporalResolve' );
	trFolder
		.add( params, 'temporalResolveMix', 0, 1, 0.025 )
		.onChange( ( value ) => ( temporalResolve.temporalResolveMix = value ) );
	trFolder
		.add( params, 'clampRadius', 1, 8, 1 )
		.onChange( ( value ) => ( temporalResolve.clampRadius = value ) );
	trFolder
		.add( params, 'newSamplesSmoothing', 0, 1, 0.025 )
		.onChange( ( value ) => ( temporalResolve.newSamplesSmoothing = value ) );
	trFolder
		.add( params, 'newSamplesCorrection', 0, 1, 0.025 )
		.onChange( ( value ) => ( temporalResolve.newSamplesCorrection = value ) );
	trFolder
		.add( params, 'weightTransform', 0, 0.5, 0.025 )
		.onChange( ( value ) => ( temporalResolve.weightTransform = value ) );
	const denoiseFolder = gui.addFolder( 'Denoising' );
	denoiseFolder.add( params, 'denoiseEnabled' );
	denoiseFolder.add( params, 'denoiseSigma', 0.01, 12.0 );
	denoiseFolder.add( params, 'denoiseThreshold', 0.01, 1.0 );
	denoiseFolder.add( params, 'denoiseKSigma', 0.0, 12.0 );

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( v => {

		ptRenderer.material.environmentRotation.setFromMatrix4( new THREE.Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	envFolder.add( params, 'environmentBlur', 0, 1 ).onChange( () => {

		updateEnvBlur();

	} );
	envFolder.add( params, 'backgroundBlur', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'backgroundAlpha', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) {

			document.body.classList.add( 'checkerboard' );

		} else {

			document.body.classList.remove( 'checkerboard' );

		}

	} );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic', 'Equirectangular' ] ).onChange( v => {

		updateCamera( v );

	} );
	cameraFolder.add( perspectiveCamera, 'focusDistance', 1, 100 ).onChange( reset );
	cameraFolder.add( perspectiveCamera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		perspectiveCamera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		reset();

	} );
	cameraFolder.add( perspectiveCamera, 'apertureRotation', 0, 12.5 ).onChange( reset );
	cameraFolder.add( perspectiveCamera, 'anamorphicRatio', 0.1, 10.0 ).onChange( reset );
	cameraFolder.add( perspectiveCamera, 'bokehSize', 0, 50 ).onChange( reset ).listen();
	cameraFolder.add( perspectiveCamera, 'fStop', 0.3, 20 ).onChange( reset ).listen();
	cameraFolder.add( perspectiveCamera, 'fov', 25, 100 ).onChange( () => {

		perspectiveCamera.updateProjectionMatrix();
		reset();

	} ).listen();

	const matFolder1 = gui.addFolder( 'Shell Material' );
	matFolder1.addColor( params.material1, 'color' ).onChange( reset );
	matFolder1.addColor( params.material1, 'emissive' ).onChange( reset );
	matFolder1.add( params.material1, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( reset );
	matFolder1.add( params.material1, 'roughness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'metalness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'opacity', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'transmission', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'ior', 0.9, 3.0 ).onChange( reset );
	matFolder1.add( params.material1, 'clearcoat', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'clearcoatRoughness', 0, 1 ).onChange( reset );
	matFolder1.addColor( params.material1, 'sheenColor' ).onChange( reset );
	matFolder1.add( params.material1, 'sheenRoughness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'iridescence', 0.0, 1.0 ).onChange( reset );
	matFolder1.add( params.material1, 'iridescenceIOR', 0.1, 3.0 ).onChange( reset );
	matFolder1.add( params.material1, 'iridescenceThickness', 0.0, 1200.0 ).onChange( reset );
	matFolder1.addColor( params.material1, 'specularColor' ).onChange( reset );
	matFolder1.add( params.material1, 'specularIntensity', 0.0, 1.0 ).onChange( reset );
	matFolder1.add( params.material1, 'matte' ).onChange( reset );
	matFolder1.add( params.material1, 'castShadow' ).onChange( reset );
	matFolder1.close();

	const matFolder2 = gui.addFolder( 'Ball Material' );
	matFolder2.addColor( params.material2, 'color' ).onChange( reset );
	matFolder2.addColor( params.material2, 'emissive' ).onChange( reset );
	matFolder2.add( params.material2, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( reset );
	matFolder2.add( params.material2, 'roughness', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'metalness', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'opacity', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'transmission', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'ior', 0.9, 3.0 ).onChange( reset );
	matFolder2.add( params.material2, 'clearcoat', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'clearcoatRoughness', 0, 1 ).onChange( reset );
	matFolder2.addColor( params.material2, 'sheenColor' ).onChange( reset );
	matFolder2.add( params.material2, 'sheenRoughness', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'iridescence', 0.0, 1.0 ).onChange( reset );
	matFolder2.add( params.material2, 'iridescenceIOR', 0.1, 3.0 ).onChange( reset );
	matFolder2.add( params.material2, 'iridescenceThickness', 0.0, 1200.0 ).onChange( reset );
	matFolder2.addColor( params.material2, 'specularColor' ).onChange( reset );
	matFolder2.add( params.material2, 'specularIntensity', 0.0, 1.0 ).onChange( reset );
	matFolder2.add( params.material2, 'matte' ).onChange( reset );
	matFolder2.add( params.material2, 'castShadow' ).onChange( reset );
	matFolder2.close();

	const matFolder3 = gui.addFolder( 'Floor Material' );
	matFolder3.addColor( params.material3, 'color' ).onChange( reset );
	matFolder3.add( params.material3, 'roughness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'metalness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'clearcoat', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'clearcoatRoughness', 0, 1 ).onChange( reset );
	matFolder3.addColor( params.material3, 'sheenColor' ).onChange( reset );
	matFolder3.add( params.material3, 'sheenRoughness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'matte' ).onChange( reset );
	matFolder3.add( params.material3, 'castShadow' ).onChange( reset );
	matFolder3.add( params.material3, 'iridescence', 0.0, 1.0 ).onChange( reset );
	matFolder3.add( params.material3, 'iridescenceIOR', 0.1, 3.0 ).onChange( reset );
	matFolder3.add( params.material3, 'iridescenceThickness', 0.0, 1200.0 ).onChange( reset );
	matFolder3.addColor( params.material3, 'specularColor' ).onChange( reset );
	matFolder3.add( params.material3, 'specularIntensity', 0.0, 1.0 ).onChange( reset );
	matFolder3.close();

	animate();

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

function reset() {

	ptRenderer.reset();

}

function updateEnvBlur() {

	const blurredTex = envMapGenerator.generate( envMap, params.environmentBlur );
	ptRenderer.material.envMapInfo.updateFrom( blurredTex );
	scene.environment = blurredTex;
	ptRenderer.reset();

}

function updateCamera( cameraProjection ) {

	if ( cameraProjection === 'Perspective' ) {

		if ( activeCamera ) {

			perspectiveCamera.position.copy( activeCamera.position );

		}

		activeCamera = perspectiveCamera;

	} else if ( cameraProjection === 'Orthographic' ) {

		if ( activeCamera ) {

			orthoCamera.position.copy( activeCamera.position );

		}

		activeCamera = orthoCamera;

	} else { // Equirect

		if ( activeCamera ) {

			equirectCamera.position.copy( activeCamera.position );

		}

		activeCamera = equirectCamera;

	}

	controls.object = activeCamera;
	ptRenderer.camera = activeCamera;

	controls.update();

	reset();

}

function animate() {

	requestAnimationFrame( animate );

	const m1 = materials[ 0 ];
	m1.color.set( params.material1.color ).convertSRGBToLinear();
	m1.emissive.set( params.material1.emissive ).convertSRGBToLinear();
	m1.emissiveIntensity = params.material1.emissiveIntensity;
	m1.metalness = params.material1.metalness;
	m1.roughness = params.material1.roughness;
	m1.transmission = params.material1.transmission;
	m1.ior = params.material1.ior;
	m1.opacity = params.material1.opacity;
	m1.clearcoat = params.material1.clearcoat;
	m1.clearcoatRoughness = params.material1.clearcoatRoughness;
	m1.sheenColor.set( params.material1.sheenColor ).convertSRGBToLinear();
	m1.sheenRoughness = params.material1.sheenRoughness;
	m1.iridescence = params.material1.iridescence;
	m1.iridescenceIOR = params.material1.iridescenceIOR;
	m1.iridescenceThicknessRange = [ 0, params.material1.iridescenceThickness ];
	m1.specularColor.set( params.material1.specularColor ).convertSRGBToLinear();
	m1.specularIntensity = params.material1.specularIntensity;

	const m2 = materials[ 1 ];
	m2.color.set( params.material2.color ).convertSRGBToLinear();
	m2.emissive.set( params.material2.emissive ).convertSRGBToLinear();
	m2.emissiveIntensity = params.material2.emissiveIntensity;
	m2.metalness = params.material2.metalness;
	m2.roughness = params.material2.roughness;
	m2.transmission = params.material2.transmission;
	m2.ior = params.material2.ior;
	m2.opacity = params.material2.opacity;
	m2.clearcoat = params.material2.clearcoat;
	m2.clearcoatRoughness = params.material2.clearcoatRoughness;
	m2.sheenColor.set( params.material2.sheenColor ).convertSRGBToLinear();
	m2.sheenRoughness = params.material2.sheenRoughness;
	m2.iridescence = params.material2.iridescence;
	m2.iridescenceIOR = params.material2.iridescenceIOR;
	m2.iridescenceThicknessRange = [ 0, params.material2.iridescenceThickness ];
	m2.specularColor.set( params.material2.specularColor ).convertSRGBToLinear();
	m2.specularIntensity = params.material2.specularIntensity;

	const m3 = materials[ 2 ];
	m3.color.set( params.material3.color ).convertSRGBToLinear();
	m3.metalness = params.material3.metalness;
	m3.roughness = params.material3.roughness;
	m3.clearcoat = params.material3.clearcoat;
	m3.clearcoatRoughness = params.material3.clearcoatRoughness;
	m3.sheenColor.set( params.material3.sheenColor ).convertSRGBToLinear();
	m3.sheenRoughness = params.material3.sheenRoughness;
	m3.iridescence = params.material3.iridescence;
	m3.iridescenceIOR = params.material3.iridescenceIOR;
	m3.iridescenceThicknessRange = [ 0, params.material3.iridescenceThickness ];
	m3.specularColor.set( params.material3.specularColor ).convertSRGBToLinear();
	m3.specularIntensity = params.material3.specularIntensity;

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.materials.setMatte( 0, params.material1.matte );
	ptRenderer.material.materials.setMatte( 1, params.material2.matte );
	ptRenderer.material.materials.setMatte( 2, params.material3.matte );
	ptRenderer.material.materials.setCastShadow( 0, params.material1.castShadow );
	ptRenderer.material.materials.setCastShadow( 1, params.material2.castShadow );
	ptRenderer.material.materials.setCastShadow( 2, params.material3.castShadow );

	ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
	ptRenderer.material.environmentIntensity = params.environmentIntensity;
	ptRenderer.material.backgroundBlur = params.backgroundBlur;
	ptRenderer.material.bounces = params.bounces;
	ptRenderer.material.backgroundAlpha = params.backgroundAlpha;
	ptRenderer.material.physicalCamera.updateFrom( activeCamera );

	activeCamera.updateMatrixWorld();

	if ( params.backgroundAlpha < 1.0 ) {

		scene.background = null;

	} else {

		scene.background = scene.environment;

	}

	for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

		ptRenderer.update();

	}

	if ( ptRenderer.samples < 1 ) {

		renderer.render( scene, activeCamera );

	}

	denoiseQuad.material.sigma = params.denoiseSigma;
	denoiseQuad.material.threshold = params.denoiseThreshold;
	denoiseQuad.material.kSigma = params.denoiseKSigma;

	const quad = params.denoiseEnabled ? denoiseQuad : blitQuad;

	renderer.autoClear = false;
	quad.material.map = ptRenderer.target.texture;

	if ( params.temporalResolve ) {

		temporalResolve.update();
		quad.material.map = temporalResolve.target.texture;

	}

	quad.render( renderer );
	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}



