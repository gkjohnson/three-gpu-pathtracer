import {
	ACESFilmicToneMapping,
	OrthographicCamera,
	CustomBlending,
	Scene,
	Box3,
	Mesh,
	CylinderGeometry,
	MeshPhysicalMaterial,
	NoToneMapping,
	WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicalCamera, BlurredEnvMapGenerator, EquirectCamera, DenoiseMaterial, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let pathTracer, controls, activeCamera, denoiseQuad, materials;
let perspectiveCamera, orthoCamera, equirectCamera;
let envMap, envMapGenerator, scene;
let samplesEl;

const orthoWidth = 5;

const params = {

	material1: {
		color: '#ffc766',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0.3,
		metalness: 0.8,
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
	material2: {
		color: '#db7157',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0.9,
		metalness: 0.1,
		transmission: 0.0,
		thinFilm: false,
		attenuationColor: '#ffffff',
		attenuationDistance: 0.5,
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
		flatShading: false,
		castShadow: true,
	},
	material3: {
		color: '#000000',
		roughness: 0.1,
		metalness: 0.05,
		matte: false,
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
	transmissiveBounces: 20,
	filterGlossyFactor: 0.5,
	tiles: 1,
	backgroundAlpha: 1,
	checkerboardTransparency: true,
	cameraProjection: 'Perspective',
};

if ( window.location.hash.includes( 'transmission' ) ) {

	params.material1.metalness = 0.0;
	params.material1.roughness = 0.23;
	params.material1.transmission = 1.0;
	params.material1.color = '#ffffff';

	params.bounces = 10;
	params.tiles = 2;

} else if ( window.location.hash.includes( 'iridescent' ) ) {

	params.material1.color = '#474747';
	params.material1.roughness = 0.25;
	params.material1.metalness = 1.0;
	params.material1.iridescence = 1.0;
	params.material1.iridescenceIOR = 2.2;

} else if ( window.location.hash.includes( 'acrylic' ) ) {

	params.material1.color = '#ffffff';
	params.material1.roughness = 0;
	params.material1.metalness = 0;
	params.material1.transmission = 1.0;
	params.material1.attenuationDistance = 0.75;
	params.material1.attenuationColor = '#2a6dc6';

	params.material2.color = '#ffffff';
	params.material2.roughness = 0.0;
	params.material2.metalness = 0.975;

	params.material3.color = '#999999';
	params.material3.roughness = 0.2;
	params.material3.metalness = 0.0;

	params.bounces = 20;
	params.tiles = 3;

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

	const renderer = new WebGLRenderer( { antialias: true } );
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.toneMapping = ACESFilmicToneMapping;
	pathTracer.setClearColor( 0, 0 );
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.renderToCanvasCallback = ( target, renderer, quad ) => {

		denoiseQuad.material.sigma = params.denoiseSigma;
		denoiseQuad.material.threshold = params.denoiseThreshold;
		denoiseQuad.material.kSigma = params.denoiseKSigma;

		const autoClear = renderer.autoClear;
		const finalQuad = params.denoiseEnabled ? denoiseQuad : quad;
		renderer.autoClear = false;
		finalQuad.material.map = target.texture;
		finalQuad.render( renderer );
		renderer.autoClear = autoClear;

	};

	document.body.appendChild( pathTracer.domElement );

	denoiseQuad = new FullScreenQuad( new DenoiseMaterial( {
		map: null,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 4, 2, 3 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.set( - 4, 2, 3 );

	equirectCamera = new EquirectCamera();
	equirectCamera.position.set( - 4, 2, 3 );

	controls = new OrbitControls( perspectiveCamera, pathTracer.domElement );
	controls.addEventListener( 'change', () => {

		pathTracer.reset();

	} );

	scene = new Scene();

	samplesEl = document.getElementById( 'samples' );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' )
		.then( texture => {

			envMap = texture;

		} );

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/material-balls/material_ball_v2.glb' )
		.then( gltf => {

			gltf.scene.scale.setScalar( 0.01 );
			gltf.scene.updateMatrixWorld();
			scene.add( gltf.scene );

			const box = new Box3();
			box.setFromObject( gltf.scene );

			const floor = new Mesh(
				new CylinderGeometry( 3, 3, 0.05, 200 ),
				new MeshPhysicalMaterial( { color: 0xffffff, roughness: 0, metalness: 0.25 } ),
			);
			floor.geometry = floor.geometry.toNonIndexed();
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.03;
			scene.add( floor );

			const material1 = new MeshPhysicalMaterial();
			const material2 = new MeshPhysicalMaterial();

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

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );

	updateCamera( params.cameraProjection );
	updateEnvBlur();
	reset();

	document.getElementById( 'loading' ).remove();
	document.body.classList.add( 'checkerboard' );

	onResize();
	window.addEventListener( 'resize', onResize );
	const gui = new GUI();

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'acesToneMapping' ).onChange( value => {

		pathTracer.toneMapping = value ? ACESFilmicToneMapping : NoToneMapping;

	} );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( reset );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( reset );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( reset );
	ptFolder.add( params, 'transmissiveBounces', 0, 40, 1 ).onChange( reset );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const denoiseFolder = gui.addFolder( 'Denoising' );
	denoiseFolder.add( params, 'denoiseEnabled' );
	denoiseFolder.add( params, 'denoiseSigma', 0.01, 12.0 );
	denoiseFolder.add( params, 'denoiseThreshold', 0.01, 1.0 );
	denoiseFolder.add( params, 'denoiseKSigma', 0.0, 12.0 );
	denoiseFolder.close();

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 10 ).onChange( reset );
	envFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( reset );
	envFolder.add( params, 'environmentBlur', 0, 1 ).onChange( () => {

		updateEnvBlur();

	} );
	envFolder.add( params, 'backgroundBlur', 0, 1 ).onChange( reset );
	envFolder.add( params, 'backgroundAlpha', 0, 1 ).onChange( reset );
	envFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) {

			document.body.classList.add( 'checkerboard' );

		} else {

			document.body.classList.remove( 'checkerboard' );

		}

	} );
	envFolder.close();

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
	cameraFolder.close();

	const matFolder1 = gui.addFolder( 'Shell Material' );
	matFolder1.addColor( params.material1, 'color' ).onChange( reset );
	matFolder1.addColor( params.material1, 'emissive' ).onChange( reset );
	matFolder1.add( params.material1, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( reset );
	matFolder1.add( params.material1, 'roughness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'metalness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'opacity', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'transmission', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'thinFilm', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'attenuationDistance', 0.05, 2.0 ).onChange( reset );
	matFolder1.addColor( params.material1, 'attenuationColor' ).onChange( reset );
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
	matFolder1.add( params.material1, 'flatShading' ).onChange( reset );
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
	matFolder1.add( params.material2, 'thinFilm', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'attenuationDistance', 0.05, 2.0 ).onChange( reset );
	matFolder2.addColor( params.material2, 'attenuationColor' ).onChange( reset );
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
	matFolder2.add( params.material2, 'flatShading' ).onChange( reset );
	matFolder2.add( params.material2, 'castShadow' ).onChange( reset );
	matFolder2.close();

	const matFolder3 = gui.addFolder( 'Floor Material' );
	matFolder3.addColor( params.material3, 'color' ).onChange( reset );
	matFolder3.add( params.material3, 'roughness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'metalness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'matte' ).onChange( reset );
	matFolder3.close();

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	pathTracer.setSize( w, h );
	pathTracer.setPixelRatio( dpr );

	const aspect = w / h;

	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

}

function reset() {

	const m1 = materials[ 0 ];
	m1.color.set( params.material1.color ).convertSRGBToLinear();
	m1.emissive.set( params.material1.emissive ).convertSRGBToLinear();
	m1.emissiveIntensity = params.material1.emissiveIntensity;
	m1.metalness = params.material1.metalness;
	m1.roughness = params.material1.roughness;
	m1.transmission = params.material1.transmission;
	m1.attenuationDistance = params.material1.thinFilm ? Infinity : params.material1.attenuationDistance;
	m1.attenuationColor.set( params.material1.attenuationColor );
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
	m1.transparent = m1.opacity < 1;
	m1.flatShading = params.material1.flatShading;

	const m2 = materials[ 1 ];
	m2.color.set( params.material2.color ).convertSRGBToLinear();
	m2.emissive.set( params.material2.emissive ).convertSRGBToLinear();
	m2.emissiveIntensity = params.material2.emissiveIntensity;
	m2.metalness = params.material2.metalness;
	m2.roughness = params.material2.roughness;
	m2.transmission = params.material2.transmission;
	m2.attenuationDistance = params.material2.thinFilm ? Infinity : params.material2.attenuationDistance;
	m2.attenuationColor.set( params.material2.attenuationColor );
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
	m2.transparent = m2.opacity < 1;
	m2.flatShading = params.material2.flatShading;

	const m3 = materials[ 2 ];
	m3.color.set( params.material3.color ).convertSRGBToLinear();
	m3.metalness = params.material3.metalness;
	m3.roughness = params.material3.roughness;
	m3.transparent = m3.opacity < 1;

	pathTracer.transmissiveBounces = params.transmissiveBounces;
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	pathTracer.renderScale = params.resolutionScale;

	// TODO: remove this
	const ptRenderer = pathTracer._pathTracer;
	ptRenderer.material.materials.setMatte( 0, params.material1.matte );
	ptRenderer.material.materials.setMatte( 1, params.material2.matte );
	ptRenderer.material.materials.setMatte( 2, params.material3.matte );
	ptRenderer.material.materials.setCastShadow( 0, params.material1.castShadow );
	ptRenderer.material.materials.setCastShadow( 1, params.material2.castShadow );

	scene.backgroundBlurriness = params.backgroundBlur;
	scene.environmentIntensity = params.environmentIntensity;
	scene.backgroundIntensity = params.environmentIntensity;
	scene.environmentRotation.y = params.environmentRotation;
	scene.backgroundRotation.y = params.environmentRotation;

	pathTracer.setClearAlpha( params.backgroundAlpha );

	activeCamera.updateMatrixWorld();

	if ( params.backgroundAlpha < 1.0 ) {

		scene.background = null;

	} else {

		scene.background = scene.environment;

	}

	pathTracer.updateScene( activeCamera, scene );

}

function updateEnvBlur() {

	const blurredTex = envMapGenerator.generate( envMap, params.environmentBlur );
	scene.environment = blurredTex;
	scene.background = blurredTex;
	reset();

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

	controls.update();

	reset();

}

function animate() {

	requestAnimationFrame( animate );
	pathTracer.renderSample();
	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}
