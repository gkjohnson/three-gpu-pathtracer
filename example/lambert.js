import { ACESFilmicToneMapping, NoToneMapping, Box3, LoadingManager, EquirectangularReflectionMapping, PMREMGenerator, Sphere, Euler, Color, DoubleSide } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'three/examples/jsm/libs/dat.gui.module.js';
import { PathTracingViewer } from '../src/classes/PathTracingViewer.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

const creditEl = document.getElementById( 'credits' );
const loadingEl = document.getElementById( 'loading' );
const samplesEl = document.getElementById( 'samples' );

const viewer = new PathTracingViewer();
viewer.init();
viewer.domElement.style.width = '100%';
viewer.domElement.style.height = '100%';
document.body.appendChild( viewer.domElement );

const envMaps = {
	'Royal Esplanade': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr',
	'Moonless Golf': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/moonless_golf_1k.hdr',
	'Overpass': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
	'Venice Sunset': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr',
};

const models = {
	'M2020 Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/nasa-m2020/Perseverance.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},
	'Neko Stop Diorama': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/neko-stop-diorama/scene.gltf',
		credit: 'Model by "Art by Kidd" on Sketchfab.',
		rotation: new Euler( 0, 1.15 * Math.PI / 4, 0 ),
		removeEmission: true,
	},
	'Japanese Temple': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/japanese-temple/scene.gltf',
		credit: 'Japanese Temple Model by "Aditya Graphical" on Sketchfab.',
	},
	'Statue': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/threedscans/Le_Transi_De_Rene_De_Chalon.glb',
		credit: 'Model courtesy of threedscans.com.',
	},
	'Crab Sculpture': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/threedscans/Elbow_Crab.glb',
		rotation: new Euler( 3.1 * Math.PI / 4, Math.PI, 0 ),
		credit: 'Model courtesy of threedscans.com.',
	},
	'Stylized Carriage': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/wooden-stylised-carriage/scene.gltf',
		credit: 'Model by "LamedeFeu" on Sketchfab.',
	},
};

const params = {

	acesToneMapping: true,
	resolutionScale: 0.5,
	tilesX: 2,
	tilesY: 2,
	samplesPerFrame: 1,

	model: 'M2020 Rover',

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

function updateModel() {

	if ( gui ) {

		gui.destroy();
		gui = null;

	}

	let model;
	const manager = new LoadingManager();
	const modelInfo = models[ params.model ];

	viewer.pausePathTracing = true;
	viewer.renderer.domElement.style.visibility = 'hidden';
	samplesEl.innerText = '--';
	creditEl.innerText = '--';
	loadingEl.innerText = 'Loading';
	loadingEl.style.visibility = 'visible';

	manager.onLoad = async () => {

		if ( modelInfo.rotation ) {

			model.rotation.copy( modelInfo.rotation );

		}

		if ( modelInfo.removeEmission ) {

			model.traverse( c => {

				if ( c.material ) {

					c.material.emissiveMap = null;
					c.material.emissiveIntensity = 0;

				}

			} );

		}

		const childrenToRemove = [];
		model.traverse( c => {

			if ( c.material ) {

				c.material.side = DoubleSide;
				c.material.depthWrite = true;
				c.material.transparent = false;

				if ( c.material.opacity < 1 ) {

					childrenToRemove.push( c );

				}

			}

		} );
		childrenToRemove.forEach( c => c.parent.remove( c ) );


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

		await viewer.setModel( model, { onProgress: v => {

			const percent = Math.floor( 100 * v );
			loadingEl.innerText = `Building BVH : ${ percent }%`;

		} } );

		loadingEl.style.visibility = 'hidden';

		creditEl.innerText = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		buildGui();

		viewer.pausePathTracing = false;
		viewer.renderer.domElement.style.visibility = 'visible';

	};

	new GLTFLoader( manager )
		.setMeshoptDecoder( MeshoptDecoder )
		.load(
			modelInfo.url,
			gltf => {

				model = gltf.scene;

			},
			progress => {

				if ( progress.total !== 0 && progress.total >= progress.loaded ) {

					const percent = Math.floor( 100 * progress.loaded / progress.total );
					loadingEl.innerText = `Loading : ${ percent }%`;

				}

			},
		);


}

const stats = new Stats();
document.body.appendChild( stats.dom );
viewer.renderer.physicallyCorrectLights = true;
viewer.renderer.toneMapping = ACESFilmicToneMapping;
viewer.ptRenderer.material.setDefine( 'GRADIENT_BG', 1 );
viewer.scene.background = new Color( 0x060606 );
viewer.ptRenderer.tiles.set( params.tilesX, params.tilesY );
viewer.setScale( 0.5 );
viewer.onRender = () => {

	stats.update();
	const samples = Math.floor( viewer.ptRenderer.samples );
	samplesEl.innerText = `samples: ${ samples }`;

};

updateModel();
updateEnvMap();
