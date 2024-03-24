import {
	WebGLRenderer,
	ACESFilmicToneMapping,
	PerspectiveCamera,
	MeshBasicMaterial,
	CustomBlending,
	Scene,
	Group,
	Box3,
	Mesh,
	CylinderGeometry,
	MeshPhysicalMaterial,
	NoToneMapping,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, BlurredEnvMapGenerator } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let renderer, controls, sceneInfo, ptRenderer, blitQuad, materials;
let perspectiveCamera, database;
let envMap, envMapGenerator, scene;
let samplesEl, materialEl, imgEl, infoEl;

const params = {
	hideInfo: false,
	acesToneMapping: true,
	stableNoise: false,
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
	renderer.setClearColor( 0, 0 );
	document.body.appendChild( renderer.domElement );

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( - 4, 2, 3 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = perspectiveCamera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.tiles.set( params.tiles, params.tiles );

	blitQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	scene = new Scene();

	samplesEl = document.getElementById( 'samples' );
	materialEl = document.getElementById( 'materialInfo' );
	imgEl = document.getElementById( 'materialImage' );
	infoEl = document.getElementById( 'info' );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/autoshop_01_1k.hdr' )
		.then( texture => {

			envMap = texture;

			updateEnvBlur();

		} );

	const generator = new PathTracingSceneWorker();
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

			return generator.generate( group );

		} )
		.then( result => {

			sceneInfo = result;

			scene.add( result.scene );

			const { bvh, textures, materials, geometry } = result;
			const material = ptRenderer.material;

			material.bvh.updateFrom( bvh );
			material.attributesArray.updateFrom(
				geometry.attributes.normal,
				geometry.attributes.tangent,
				geometry.attributes.uv,
				geometry.attributes.color,
			);
			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
			material.textures.setTextures( renderer, 2048, 2048, textures );
			material.materials.updateFrom( materials, textures );

			generator.dispose();

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

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();

	const materialNames = Object.keys( database );
	params.material = materialNames[ 0 ];
	gui.add( params, 'material', materialNames ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'hideInfo' );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'acesToneMapping' ).onChange( value => {

		renderer.toneMapping = value ? ACESFilmicToneMapping : NoToneMapping;
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
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );

	const envFolder = gui.addFolder( 'Environment' );
	envFolder.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'environmentRotation', 0, 2 * Math.PI ).onChange( v => {

		ptRenderer.material.environmentRotation.makeRotationY( v );
		ptRenderer.reset();

	} );
	envFolder.add( params, 'environmentBlur', 0, 1 ).onChange( () => {

		updateEnvBlur();

	} );
	envFolder.add( params, 'backgroundBlur', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );

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

}

function updateEnvBlur() {

	const blurredTex = envMapGenerator.generate( envMap, params.environmentBlur );
	ptRenderer.material.envMapInfo.updateFrom( blurredTex );
	scene.environment = blurredTex;
	ptRenderer.reset();

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
	imgEl.src = `https://physicallybased.info/reference/render/${ cleanName }-cycles.webp`;
	materialEl.innerText = `${ info.description }`;
	materialEl.style.display = info.description ? 'inline-block' : 'none';

}

function animate() {

	requestAnimationFrame( animate );

	infoEl.style.visibility = params.hideInfo ? 'hidden' : 'visible';

	const materialInfo = database[ params.material ];
	const [ shellMaterial, coreMaterial ] = materials;

	applyMaterialInfo( materialInfo, shellMaterial );
	coreMaterial.color.setRGB( 0.5, 0.5, 0.5 ).convertSRGBToLinear();
	coreMaterial.roughness = 1.0;
	coreMaterial.metalness = 0.0;

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
	ptRenderer.material.environmentIntensity = params.environmentIntensity;
	ptRenderer.material.backgroundBlur = params.backgroundBlur;
	ptRenderer.material.bounces = params.bounces;
	ptRenderer.material.physicalCamera.updateFrom( perspectiveCamera );

	perspectiveCamera.updateMatrixWorld();

	if ( params.backgroundAlpha < 1.0 ) {

		scene.background = null;

	} else {

		scene.background = scene.environment;

	}

	ptRenderer.update();

	if ( ptRenderer.samples < 1 ) {

		renderer.render( scene, perspectiveCamera );

	}

	renderer.autoClear = false;
	blitQuad.material.map = ptRenderer.target.texture;
	blitQuad.render( renderer );
	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}




