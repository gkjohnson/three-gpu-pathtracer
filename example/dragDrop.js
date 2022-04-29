import { ACESFilmicToneMapping, NoToneMapping, Box3, LoadingManager, EquirectangularReflectionMapping, PMREMGenerator, Sphere, Color, DoubleSide } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { PathTracingViewer } from '../src/viewers/PathTracingViewer.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import * as MikkTSpace from './lib/mikktspace.module.js';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough } from '@gltf-transform/functions';
import { DocumentView, ImageProvider } from '@gltf-transform/view';
import { getFilesFromDataTransferItems } from "@placemarkio/flat-drop-files";

const creditEl = document.getElementById( 'credits' );
const loadingEl = document.getElementById( 'loading' );
const samplesEl = document.getElementById( 'samples' );

const viewer = new PathTracingViewer();
viewer.init();
viewer.domElement.style.width = '100%';
viewer.domElement.style.height = '100%';
document.body.appendChild( viewer.domElement );

const io = new WebIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({'meshopt.decoder': MeshoptDecoder});
const imageProvider = new ImageProvider();

const envMaps = {
	'Royal Esplanade': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr',
	'Moonless Golf': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/moonless_golf_1k.hdr',
	'Overpass': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
	'Venice Sunset': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr',
};

const params = {

	acesToneMapping: true,
	resolutionScale: 0.75 / window.devicePixelRatio,
	tilesX: 2,
	tilesY: 2,
	samplesPerFrame: 1,

	environment: 'ENVMAP',
	envMap: envMaps[ 'Royal Esplanade' ],

	gradientTop: '#bfd8ff',
	gradientBottom: '#ffffff',

	environmentIntensity: 3.0,
	environmentBlur: 0.35,

	backgroundType: 'Gradient',
	bgGradientTop: '#111111',
	bgGradientBottom: '#000000',

	enable: true,
	bounces: 3,

	floorColor: '#080808',
	floorEnabled: true,

};

let gui = null;
function buildGui() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( v => {

		viewer.setScale( parseFloat( v ) );

	} );
	resolutionFolder.add( params, 'samplesPerFrame', 1, 10, 1 ).onChange( v => {

		viewer.samplesPerFrame = parseInt( v );

	} );
	resolutionFolder.add( params, 'tilesX', 1, 10, 1 ).onChange( v => {

		viewer.ptRenderer.tiles.x = parseInt( v );

	} );
	resolutionFolder.add( params, 'tilesY', 1, 10, 1 ).onChange( v => {

		viewer.ptRenderer.tiles.y = parseInt( v );

	} );
	resolutionFolder.open();

	const environmentFolder = gui.addFolder( 'environment' );
	environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );
	environmentFolder.add( params, 'environmentBlur', 0.0, 1.0, 0.01 ).onChange( v => {

		viewer.ptRenderer.material.environmentBlur = parseFloat( v );
		viewer.ptRenderer.reset();

	} ).name( 'env map blur' );
	environmentFolder.add( params, 'environmentIntensity', 0.0, 10.0, 0.01 ).onChange( v => {

		viewer.ptRenderer.material.environmentIntensity = parseFloat( v );
		viewer.ptRenderer.reset();

	} ).name( 'intensity' );
	environmentFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'backgroundType', [ 'Environment', 'Gradient' ] ).onChange( v => {

		viewer.ptRenderer.material.setDefine( 'GRADIENT_BG', Number( v === 'Gradient' ) );
		if ( v === 'Gradient' ) {

			viewer.scene.background = new Color( 0x060606 );

		} else {

			viewer.scene.background = viewer.scene.environment;

		}

		viewer.ptRenderer.reset();

	} );
	backgroundFolder.addColor( params, 'bgGradientTop' ).onChange( v => {

		viewer.ptRenderer.material.uniforms.bgGradientTop.value.set( v );
		viewer.ptRenderer.reset();

	} );
	backgroundFolder.addColor( params, 'bgGradientBottom' ).onChange( v => {

		viewer.ptRenderer.material.uniforms.bgGradientBottom.value.set( v );
		viewer.ptRenderer.reset();

	} );
	backgroundFolder.open();

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.add( params, 'floorEnabled' ).onChange( v => {

		viewer.ptRenderer.material.setDefine( 'DISPLAY_FLOOR', Number( v ) );
		viewer.ptRenderer.reset();

	} );
	floorFolder.addColor( params, 'floorColor' ).onChange( v => {

		viewer.ptRenderer.material.uniforms.floorColor.value.set( v );
		viewer.ptRenderer.reset();

	} );

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params, 'enable' ).onChange( v => {

		viewer.enablePathTracing = v;

	} );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( v => {

		viewer.renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;
		viewer.fsQuad.material.needsUpdate = true;

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( v => {

		viewer.ptRenderer.material.setDefine( 'BOUNCES', parseInt( v ) );
		viewer.ptRenderer.reset();

	} );
	pathTracingFolder.open();

}

function updateEnvMap() {

	new RGBELoader()
		.load( params.envMap, texture => {

			if ( viewer.ptRenderer.material.environmentMap ) {

				viewer.ptRenderer.material.environmentMap.dispose();
				viewer.scene.environment.dispose();

			}

			const pmremGenerator = new PMREMGenerator( viewer.renderer );
			pmremGenerator.compileCubemapShader();

			const envMap = pmremGenerator.fromEquirectangular( texture );

			texture.mapping = EquirectangularReflectionMapping;
			viewer.ptRenderer.material.environmentIntensity = parseFloat( params.environmentIntensity );
			viewer.ptRenderer.material.environmentMap = envMap.texture;
			viewer.scene.environment = texture;
			if ( params.backgroundType !== 'Gradient' ) {

				viewer.scene.background = texture;

			}

			viewer.ptRenderer.reset();

		} );

}

async function updateModel( modelDocument ) {

	if ( gui ) {

		gui.destroy();
		gui = null;

	}

	await MikkTSpace.ready;

	imageProvider.clear();

	const modelRootDef = modelDocument.getRoot();
	const modelSceneDef = modelRootDef.getDefaultScene() || modelRootDef.listScenes()[0];
	const extensionsUsed = modelDocument.getRoot().listExtensionsUsed();

	// prepare model

	if ( extensionsUsed.some( ( ext ) => ext.extensionName === 'KHR_materials_pbrSpecularGlossiness' ) ) {

		await modelDocument.transform( metalRough() );

	}

	// create three.js view of glTF document

	await imageProvider.update( modelRootDef.listTextures() );
	const modelView = new DocumentView( modelDocument )
		.setImageProvider( imageProvider );
	const model = modelView.view( modelSceneDef );

	// center the model

	const box = new Box3();
	box.setFromObject( model );
	model.position
		.addScaledVector( box.min, - 0.5 )
		.addScaledVector( box.max, - 0.5 );

	const sphere = new Sphere();
	box.getBoundingSphere( sphere );

	model.scale.setScalar( 1 / sphere.radius );
	model.position.multiplyScalar( 1 / sphere.radius );

	// load the model

	await viewer.setModel( model, { onProgress: v => {

		const percent = Math.floor( 100 * v );
		loadingEl.innerText = `Building BVH : ${ percent }%`;

	} } );

	loadingEl.style.visibility = 'hidden';

	buildGui();

	viewer.pausePathTracing = false;
	viewer.renderer.domElement.style.visibility = 'visible';
	viewer.ptRenderer.material.uniforms.floorHeight.value = - ( box.max.y - box.min.y ) / ( 2 * sphere.radius );

}

const stats = new Stats();
document.body.appendChild( stats.dom );
viewer.renderer.physicallyCorrectLights = true;
viewer.renderer.toneMapping = ACESFilmicToneMapping;
viewer.ptRenderer.material.setDefine( 'GRADIENT_BG', 1 );
viewer.scene.background = new Color( 0x060606 );
viewer.ptRenderer.tiles.set( params.tilesX, params.tilesY );
viewer.setScale( params.resolutionScale );
viewer.onRender = () => {

	stats.update();
	const samples = Math.floor( viewer.ptRenderer.samples );
	samplesEl.innerText = `samples: ${ samples }`;

};

updateEnvMap();

// drag-and-drop implementation

document.body.addEventListener( 'dragenter', ( e ) => {

	e.preventDefault();

});

document.body.addEventListener( 'dragover', ( e ) => {

	e.preventDefault();

});

document.body.addEventListener('drop', ( e ) => {

	e.preventDefault();

	viewer.pausePathTracing = true;
	viewer.renderer.domElement.style.visibility = 'hidden';
	samplesEl.innerText = '--';
	creditEl.innerText = '--';
	loadingEl.innerText = 'Parsing';
	loadingEl.style.visibility = 'visible';

	getFilesFromDataTransferItems( e.dataTransfer.items ).then( async ( files ) => {

		for ( const file of files ) {

			if ( file.name.endsWith( '.glb' ) ) {

				const arrayBuffer = await file.arrayBuffer();
				const modelJSONDocument = await io.binaryToJSON( new Uint8Array( arrayBuffer ) );
				const modelDocument = await io.readJSON( modelJSONDocument );

				creditEl.innerText = JSON.stringify( modelJSONDocument.json.asset, null, 2 );

				updateModel( modelDocument );
				return;

			}

		}

	});

});

