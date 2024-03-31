import {
	ACESFilmicToneMapping,
	PerspectiveCamera,
	Scene,
	Group,
	Box3,
	Mesh,
	CylinderGeometry,
	MeshPhysicalMaterial,
	NoToneMapping,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlurredEnvMapGenerator, WebGLPathTracer } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let pathTracer, renderer, controls, materials;
let perspectiveCamera, database;
let envMap, envMapGenerator, scene;
let samplesEl, imgEl, infoEl;

const params = {
	material: null,
	hideInfo: false,
	acesToneMapping: true,
	tiles: 2,
	bounces: 5,
	multipleImportanceSampling: true,
	resolutionScale: 1 / window.devicePixelRatio,
	environmentBlur: 0,
	environmentIntensity: 1,
	environmentRotation: 0,
	backgroundBlur: 0.1,
	filterGlossyFactor: 0.5,
};

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.max( params.bounces, 6 );
	params.resolutionScale *= 0.5;
	params.tiles = 2;
	params.multipleImportanceSampling = false;
	params.environmentBlur = 0.35;
	params.hideInfo = true;

}

init();

async function init() {

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.tiles.set( params.tiles, params.tiles );

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 4, 2, 3 );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		reset();

	} );

	scene = new Scene();

	samplesEl = document.getElementById( 'samples' );
	imgEl = document.getElementById( 'materialImage' );
	infoEl = document.getElementById( 'info' );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/autoshop_01_1k.hdr' )
		.then( texture => {

			envMap = texture;

		} );

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/material-balls/material_ball_v2.glb' )
		.then( gltf => {

			const group = new Group();

			gltf.scene.scale.setScalar( 0.01 );
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			const box = new Box3();
			box.setFromObject( gltf.scene );

			const floor = new Mesh(
				new CylinderGeometry( 3, 3, 0.05, 200 ),
				new MeshPhysicalMaterial( { color: 0xffffff, roughness: 0, metalness: 0.25 } ),
			);
			floor.geometry = floor.geometry.toNonIndexed();
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.03;
			group.add( floor );

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

			scene.add( group );

		} );

	const databasePromise = fetch( 'https://api.physicallybased.info/materials' )
		.then( res => res.json() )
		.then( json => {

			database = {};
			json.forEach( mat => {

				database[ mat.name ] = mat;

			} );

		} );

	await Promise.all( [ databasePromise, gltfPromise, envMapPromise ] );

	const materialNames = Object.keys( database );
	params.material = materialNames[ 0 ];

	document.getElementById( 'loading' ).remove();

	updateEnvBlur();
	reset();
	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'material', materialNames ).onChange( reset );
	gui.add( params, 'hideInfo' );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'acesToneMapping' ).onChange( value => {

		renderer.toneMapping = value ? ACESFilmicToneMapping : NoToneMapping;

	} );
	ptFolder.add( params, 'multipleImportanceSampling' ).onChange( reset );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		pathTracer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( reset );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( reset );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 10 ).onChange( reset );
	envFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( reset );
	envFolder.add( params, 'environmentBlur', 0, 1 ).onChange( () => {

		updateEnvBlur();

	} );
	envFolder.add( params, 'backgroundBlur', 0, 1 ).onChange( reset );

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const aspect = w / h;
	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();
	reset();

}

function updateEnvBlur() {

	const blurredTex = envMapGenerator.generate( envMap, params.environmentBlur );
	if ( scene.environment ) {

		scene.environment.dispose();

	}

	scene.environment = blurredTex;
	scene.background = blurredTex;
	reset();

}

function applyMaterialInfo( info, material ) {

	material.color.set( 0xffffff );
	material.transmission = 0.0;
	material.attenuationDistance = Infinity;
	material.attenuationColor.set( 0xffffff );
	material.specularColor.set( 0xffffff );
	material.metalness = 0.0;
	material.roughness = 1.0;
	material.ior = 1.5;
	material.thickness = 1.0;

	if ( info.specularColor ) material.specularColor.setRGB( ...info.specularColor );
	if ( 'metalness' in info ) material.metalness = info.metalness;
	if ( 'roughness' in info ) material.roughness = info.roughness;
	if ( 'ior' in info ) material.ior = info.ior;
	if ( 'transmission' in info ) material.transmission = info.transmission;

	if ( material.transmission ) {

		if ( info.color ) material.attenuationColor.setRGB( ...info.color );
		material.attenuationDistance = 200 / info.density;

	} else {

		if ( info.color ) material.color.setRGB( ...info.color );

	}

	const cleanName = info.name.replace( /\s+/g, '-' ).replace( /[()]+/g, '' );
	imgEl.src = `https://physicallybased.info/reference/render/${ cleanName }-cycles.png`;

}

function reset() {

	infoEl.style.visibility = params.hideInfo ? 'hidden' : 'visible';

	const materialInfo = database[ params.material ];
	const [ shellMaterial, coreMaterial ] = materials;

	applyMaterialInfo( materialInfo, shellMaterial );
	coreMaterial.color.setRGB( 0.5, 0.5, 0.5 ).convertSRGBToLinear();
	coreMaterial.roughness = 1.0;
	coreMaterial.metalness = 0.0;

	pathTracer.multipleImportanceSampling = params.multipleImportanceSampling;
	pathTracer.renderScale = params.resolutionScale;
	pathTracer.filterGlossyFactor = params.filterGlossyFactor;
	pathTracer.bounces = params.bounces;
	scene.environmentRotation.y = params.environmentRotation;
	scene.backgroundRotation.y = params.environmentRotation;
	scene.backgroundIntensity = params.environmentIntensity;
	scene.environmentIntensity = params.environmentIntensity;
	perspectiveCamera.updateMatrixWorld();

	if ( params.backgroundAlpha < 1.0 ) {

		scene.background = null;

	} else {

		scene.background = scene.environment;

	}

	pathTracer.setScene( perspectiveCamera, scene );

}

function animate() {

	requestAnimationFrame( animate );
	pathTracer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( pathTracer.samples ) }`;

}
