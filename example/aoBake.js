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
	MeshPhysicalMaterial
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { UVGenerator } from '../src/utils/UVGenerator.js';
import { AO_THICKNESS_SAMPLES_PER_UPDATE, AOThicknessMapGenerator } from '../src/utils/AOThicknessMapGenerator.js';

let renderer, camera, scene, stats;
let statusEl, totalSamples = 0;
let aoGenerator, aoTexture;

const AO_THICKNESS_TEXTURE_SIZE = 1024;
const MAX_SAMPLES = 1000;

init();

async function init() {

	// initialize renderer
	renderer = new WebGLRenderer( { antialias: true } );
	document.body.appendChild( renderer.domElement );

	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( - 4, 2, 3 );

	scene = new Scene();

	const light1 = new PointLight( 0xaaaaa, 20, 100 );
	light1.position.set( 3, 3, 3 );

	const light2 = new PointLight( 0xaaaaaa, 20, 100 );
	light2.position.set( - 3, - 3, - 3 );

	const ambientLight = new AmbientLight( 0xffffff, 2.75 );
	scene.add( ambientLight );

	scene.add( light1 );
	scene.add( light2 );

	new OrbitControls( camera, renderer.domElement );
	statusEl = document.getElementById( 'status' );

	const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';

	const uvGenerator = new UVGenerator();
	await uvGenerator.init();

	const geometriesToBake = [];

	const aoTarget = new WebGLRenderTarget( AO_THICKNESS_TEXTURE_SIZE, AO_THICKNESS_TEXTURE_SIZE, {
		type: FloatType,
		colorSpace: LinearSRGBColorSpace,
		generateMipmaps: true,
		format: RGBAFormat,
	} );

	aoGenerator = new AOThicknessMapGenerator( renderer );
	aoGenerator.samples = MAX_SAMPLES;
	aoGenerator.channel = 2;
	aoGenerator.aoRadius = 2;
	aoGenerator.thicknessRadius = 0.5;
	aoTexture = aoTarget.texture;
	aoTexture.channel = 2;

	const aoMaterial = new MeshPhysicalMaterial( {

		aoMap: aoTexture,
		thicknessMap: aoTexture,

	} );

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
			gltf.scene.position.y = - 0.25 * ( box.max.y - box.min.y ) * 2.5 / sphere.radius;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			group.traverse( c => {

				if ( c.isMesh ) {

					geometriesToBake.push( c.geometry );

					c.material = aoMaterial;

				}

			} );

			group.updateMatrixWorld( true );
			scene.add( group );

		} );

	await gltfPromise;

	document.getElementById( 'loading' ).remove();

	uvGenerator.channel = 2;

	uvGenerator.generate( geometriesToBake, ( item, percentage ) => {

		if ( percentage % 10 === 0 ) {

			console.log( `UV Generation: ${ percentage } % of ${ item }` );

		}

	} );

	aoGenerator.startGeneration( geometriesToBake, aoTarget );

	onResize();
	window.addEventListener( 'resize', onResize );

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

	renderer.setRenderTarget( null );
	aoTexture.needsUpdate = true;
	renderer.render( scene, camera );

	if ( aoGenerator ) {

		statusEl.innerText = `Samples: ${ totalSamples } of ${ MAX_SAMPLES }`;


	}

}
