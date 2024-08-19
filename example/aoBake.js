import {
	WebGLRenderer,
	PerspectiveCamera,
	Scene,
	PointLight,
	AmbientLight,
	WebGLRenderTarget,
	FloatType,
	LinearSRGBColorSpace,
	RGBAFormat,
	Group,
	Box3,
	Sphere,
	MeshPhysicalMaterial,
	EquirectangularReflectionMapping,
	MeshBasicMaterial
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { UVGenerator } from '../src/utils/UVGenerator.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { AO_THICKNESS_SAMPLES_PER_UPDATE, AOThicknessMapGenerator } from '../src/utils/AOThicknessMapGenerator.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';

let renderer, camera, scene, stats;
let statusEl, totalSamples = 0;
let aoGenerator, aoTexture, gui, aoMaterial;
let background;
let quad;

const params = {
	transmission: false,
	displayMap: false,
};

const AO_THICKNESS_TEXTURE_SIZE = 1024;
const MAX_SAMPLES = 1000;

init();

async function init() {

	// initialize renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setClearColor( 0x111111 );
	document.body.appendChild( renderer.domElement );

	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( - 4, 2, 3 );

	scene = new Scene();
	scene.backgroundRotation.set( 0, 0.75, 0 );
	scene.backgroundBlurriness = 0.1;

	const light1 = new PointLight( 0xaaaaaa, 20, 100 );
	light1.position.set( 3, 3, 3 );

	const light2 = new PointLight( 0xaaaaaa, 20, 100 );
	light2.position.set( - 3, - 3, - 3 );

	const ambientLight = new AmbientLight( 0xffffff, 2.75 );
	scene.add( ambientLight );

	// scene.add( light1 );
	// scene.add( light2 );

	new OrbitControls( camera, renderer.domElement );
	statusEl = document.getElementById( 'status' );

	// const url = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb';
	const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';

	// init ao texture
	const aoTarget = new WebGLRenderTarget( AO_THICKNESS_TEXTURE_SIZE, AO_THICKNESS_TEXTURE_SIZE, {
		type: FloatType,
		colorSpace: LinearSRGBColorSpace,
		generateMipmaps: true,
		format: RGBAFormat,
	} );
	aoTexture = aoTarget.texture;
	aoTexture.channel = 2;

	// init ao generator
	aoGenerator = new AOThicknessMapGenerator( renderer );
	aoGenerator.samples = MAX_SAMPLES;
	aoGenerator.channel = 2;
	aoGenerator.aoRadius = 2;
	aoGenerator.thicknessRadius = 0.5;

	// gltf material
	aoMaterial = new MeshPhysicalMaterial( {
		aoMap: aoTexture,
		thicknessMap: aoTexture,
		thickness: 1,
		attenuationColor: 0xfaeef2,
		attenuationDistance: 0.5,
	} );

	// quad for rendering texture result
	quad = new FullScreenQuad( new MeshBasicMaterial( {
		map: aoTexture,
	} ) );

	// uv generator
	const uvGenerator = new UVGenerator();
	uvGenerator.channel = 2;

	const envPromise = new RGBELoader()
		.loadAsync( ENV_URL )
		.then( tex => {

			tex.mapping = EquirectangularReflectionMapping;
			background = tex;

		} );

	const geometriesToBake = [];
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( async gltf => {

			const group = new Group();

			// scale the scene to a reasonable size
			const box = new Box3();
			box.setFromObject( gltf.scene );

			const sphere = new Sphere();
			box.getBoundingSphere( sphere );

			gltf.scene.scale.setScalar( 2.5 / sphere.radius );
			gltf.scene.position.y = - 0.5 * ( box.max.y - box.min.y ) * 2.5 / sphere.radius;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			group.traverse( c => {

				if ( c.isMesh ) {

					geometriesToBake.push( c.geometry );

					c.material = aoMaterial;

				}

			} );

			scene.add( group );

		} );

	// wait for promises
	await Promise.all( [ gltfPromise, envPromise, uvGenerator.init() ] );

	document.getElementById( 'loading' ).remove();

	uvGenerator.generate( geometriesToBake, ( item, percentage ) => {

		if ( percentage % 10 === 0 ) {

			console.log( `UV Generation: ${ percentage } % of ${ item }` );

		}

	} );

	aoGenerator.startGeneration( geometriesToBake, aoTarget );

	onResize();
	window.addEventListener( 'resize', onResize );

	gui = new GUI();
	gui.add( params, 'transmission' );
	gui.add( params, 'displayMap' );

	stats = new Stats();
	document.body.appendChild( stats.domElement );

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function animate() {

	stats.update();

	requestAnimationFrame( animate );

	if ( aoGenerator ) {

		if ( aoGenerator.generateSample() ) {

			totalSamples += AO_THICKNESS_SAMPLES_PER_UPDATE;

		} else {

			aoGenerator = null;

		}

	}

	if ( params.transmission ) {

		aoMaterial.transmission = 1;
		aoMaterial.color.copy( aoMaterial.attenuationColor );
		aoMaterial.color.r *= 0.75;
		aoMaterial.color.g *= 0.5;
		aoMaterial.color.b *= 0.5;
		aoMaterial.roughness = 0.25;

		scene.background = background;

	} else {

		aoMaterial.transmission = 0;
		aoMaterial.color.set( 0xffffff );
		aoMaterial.roughness = 1;

		scene.background = null;

	}

	renderer.setRenderTarget( null );

	if ( params.displayMap ) {

		aoTexture.channel = 0;
		quad.render( renderer );

	} else {

		aoTexture.channel = 2;
		renderer.render( scene, camera );

	}

	if ( aoGenerator ) {

		statusEl.innerText = `Samples: ${ totalSamples } of ${ MAX_SAMPLES }`;

	}

}
