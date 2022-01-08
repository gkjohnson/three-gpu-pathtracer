import { ACESFilmicToneMapping, NoToneMapping, Box3, LoadingManager, EquirectangularReflectionMapping, PMREMGenerator, Sphere, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'three/examples/jsm/libs/dat.gui.module.js';
import { PathTracingViewer } from '../src/classes/PathTracingViewer.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

const viewer = new PathTracingViewer();
viewer.init();
viewer.domElement.style.width = '100%';
viewer.domElement.style.height = '100%';
document.body.appendChild( viewer.domElement );

const envMaps = {
	'Royal Esplanade': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr',
	'Moonless Golf': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/moonless_golf_1k.hdr',
	'Pedestrian Overpass': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
	'Venice Sunset': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr',
};

const models = {
	'M2020 Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/nasa-m2020/Perseverance.glb',
	},
	'Statue': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/threedscans/Le_Transi_De_Rene_De_Chalon.glb',
	},
	'Crab Sculpture': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/threedscans/Elbow_Crab.glb',

	},
	'Stylized Carriage': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/wooden-stylised-carriage/scene.gltf',
	},
};

const params = {

	acesToneMapping: true,
	resolutionScale: 0.5,
	tilesX: 1,
	tilesY: 1,
	samplesPerFrame: 1,

	model: 'M2020 Rover',

	environment: 'ENVMAP',
	envMap: envMaps['Royal Esplanade'],

	gradientTop: '#bfd8ff',
	gradientBottom: '#ffffff',

	environmentIntensity: 2.0,
	environmentBlur: 0.35,

	backgroundType: 'Environment',
	bgGradientTop: '#111111',
	bgGradientBottom: '#000000',

	enable: true,
	bounces: 3,

};

let gui = null;
function buildGui() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();

	gui.add( params, 'model', Object.keys( models ) ).onChange( updateModel );

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
	environmentFolder.add( params, 'environment', [ 'ENVMAP', 'GRADIENT' ] ).onChange( v => {

		viewer.ptRenderer.material.setDefine( 'USE_ENVMAP', v === 'ENVMAP' ? 1 : 0 );
		viewer.ptRenderer.reset();

		buildGui();

	} );

	if ( params.environment === 'GRADIENT' ) {

		environmentFolder.addColor( params, 'gradientTop' ).onChange( v => {

			viewer.ptRenderer.material.uniforms.gradientTop.value.set( v );
			viewer.ptRenderer.reset();

		} );

		environmentFolder.addColor( params, 'gradientBottom' ).onChange( v => {

			viewer.ptRenderer.material.uniforms.gradientBottom.value.set( v );
			viewer.ptRenderer.reset();

		} );

	} else {

		environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );

		environmentFolder.add( params, 'environmentBlur', 0.0, 1.0, 0.01 ).onChange( v => {

			viewer.ptRenderer.material.environmentBlur = parseFloat( v );
			viewer.ptRenderer.reset();

		} ).name( 'env map blur' );

	}

	environmentFolder.add( params, 'environmentIntensity', 0.0, 350.0, 0.01 ).onChange( v => {

		viewer.ptRenderer.material.environmentIntensity = parseFloat( v );
		viewer.ptRenderer.reset();

	} ).name( 'intensity' );
	environmentFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'backgroundType', [ 'Environment', 'Gradient' ] ).onChange( v => {

		viewer.ptRenderer.material.setDefine( 'GRADIENT_BG', Number( v === 'Gradient' ) );
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

	const pathTracingFolder = gui.addFolder( 'path tracing');
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

	return new Promise( resolve => {

		new RGBELoader()
			.load( params.envMap, texture => {

				if ( viewer.ptRenderer.material.environmentMap ) {

					viewer.ptRenderer.material.environmentMap.dispose();
					viewer.scene.background.dispose();

				}

				const pmremGenerator = new PMREMGenerator( viewer.renderer );
				pmremGenerator.compileCubemapShader();

				const envMap = pmremGenerator.fromEquirectangular( texture );

				texture.mapping = EquirectangularReflectionMapping;
				viewer.ptRenderer.material.environmentIntensity = parseFloat( params.environmentIntensity );
				viewer.ptRenderer.material.environmentMap = envMap.texture;
				viewer.scene.background = texture;
				viewer.scene.environment = texture;
				viewer.ptRenderer.reset();

				resolve();

			} );

	} );

}

function updateModel() {

	function centerAndSetModel( model ) {

		const box = new Box3();
		box.setFromObject( model );
		model.position
			.addScaledVector( box.min, - 0.5 )
			.addScaledVector( box.max, - 0.5 );

		const sphere = new Sphere();
		box.getBoundingSphere( sphere );

		model.scale.setScalar( 1 / sphere.radius );
		model.position.multiplyScalar( 1 / sphere.radius );

		return viewer.setModel( model );

	}

	if ( gui ) {

		gui.destroy();
		gui = null;

	}

	let model;
	const manager = new LoadingManager();
	const modelInfo = models[ params.model ];
	manager.onLoad = async () => {

		const promises = [];
		if ( modelInfo.envMap && modelInfo.envMap !== params.envMap ) {

			params.envMap = envMaps[ modelInfo.envMap ];
			params.environmentIntensity = modelInfo.envIntensity;
			promises.push( updateEnvMap() );

		}

		promises.push( centerAndSetModel( model ) );
		await Promise.all( promises );
		buildGui();

	};

	new GLTFLoader( manager )
		.setMeshoptDecoder( MeshoptDecoder )
		.load(
			modelInfo.url,
			gltf => {

				model = gltf.scene;

				const childrenToRemove = [];
				model.traverse( c => {

					if ( c.isMesh && c.material.opacity < 1 ) {

						childrenToRemove.push( c );

					}

				} );
				childrenToRemove.forEach( c => c.parent.remove( c ) );

			}
		);


}

const stats = new Stats();
document.body.appendChild( stats.dom );
viewer.renderer.physicallyCorrectLights = true;
viewer.renderer.toneMapping = ACESFilmicToneMapping;
viewer.setScale( 0.5 );
viewer.onRender = () => {

	stats.update();
	const samples = Math.floor( viewer.ptRenderer.samples );
	const infoEl = document.getElementById( 'info' );
	infoEl.innerText = `samples: ${ samples }`;

};

// const mesh = new Mesh(
// 	new TorusKnotBufferGeometry(),
// );
// viewer.setModel( mesh );

// new LDrawLoader( manager ).load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd', result => {

// 	result.scale.setScalar( 0.001 );
// 	result.rotation.x = Math.PI;
// 	model = result;

// 	buildGui();

// } );

updateModel();
updateEnvMap();
