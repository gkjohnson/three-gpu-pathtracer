import {
	ACESFilmicToneMapping,
	NoToneMapping,
	Box3,
	LoadingManager,
	EquirectangularReflectionMapping,
	PMREMGenerator,
	Sphere,
	Color,
	DoubleSide,
	DataTexture,
	RGBAFormat,
	UnsignedByteType,
	LinearFilter,
	RepeatWrapping,
	Mesh,
	MeshStandardMaterial,
	PlaneBufferGeometry,
	Group,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { PathTracingViewer } from '../src/viewers/PathTracingViewer.js';
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

const models = window.MODEL_LIST || {
	'M2020 Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/nasa-m2020/Perseverance.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},
	'Damaged Helmet': {
		url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf',
		credit: 'glTF Sample Model.',
		rotation: [ 0, 1.15 * Math.PI / 4, 0 ],
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
		rotation: [ 3.1 * Math.PI / 4, Math.PI, 0 ],
		credit: 'Model courtesy of threedscans.com.',
	},
	'Stylized Carriage': {
		url: 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/wooden-stylised-carriage/scene.gltf',
		credit: 'Model by "LamedeFeu" on Sketchfab.',
	},

};

const params = {

	acesToneMapping: true,
	resolutionScale: 1 / window.devicePixelRatio,
	tilesX: 2,
	tilesY: 2,
	samplesPerFrame: 1,

	model: Object.keys( models )[ 0 ],

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
	floorRoughness: 0.1,

};

const floorTex = generateRadialFloorTexture( 2048 );
const floorPlane = new Mesh(
	new PlaneBufferGeometry(),
	new MeshStandardMaterial( {
		map: floorTex,
		transparent: true,
		color: 0x080808,
		roughness: 0.1,
	} )
);
floorPlane.scale.setScalar( 3 );
floorPlane.rotation.x = - Math.PI / 2;

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

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.add( params, 'floorEnabled' ).onChange( v => {

		floorPlane.material.opacity = v ? 1 : 0;
		viewer.ptRenderer.reset();

	} );
	floorFolder.addColor( params, 'floorColor' ).onChange( v => {

		floorPlane.material.color.set( v );
		viewer.ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorRoughness', 0, 1 ).onChange( v => {

		floorPlane.material.roughness = v;
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

function generateRadialFloorTexture( dim ) {

	const data = new Uint8Array( dim * dim * 4 );

	for ( let x = 0; x < dim; x ++ ) {

		for ( let y = 0; y < dim; y ++ ) {

			const xNorm = x / ( dim - 1 );
			const yNorm = y / ( dim - 1 );

			const xCent = 2.0 * ( xNorm - 0.5 );
			const yCent = 2.0 * ( yNorm - 0.5 );
			let a = Math.max( Math.min( 1.0 - Math.sqrt( xCent ** 2 + yCent ** 2 ), 1.0 ), 0.0 );
			a = a ** 2;
			a = Math.min( a, 1.0 );

			const i = y * dim + x;
			data[ i * 4 + 0 ] = 255;
			data[ i * 4 + 1 ] = 255;
			data[ i * 4 + 2 ] = 255;
			data[ i * 4 + 3 ] = a * 255;

		}

	}

	const tex = new DataTexture( data, dim, dim );
	tex.format = RGBAFormat;
	tex.type = UnsignedByteType;
	tex.minFilter = LinearFilter;
	tex.magFilter = LinearFilter;
	tex.wrapS = RepeatWrapping;
	tex.wrapT = RepeatWrapping;
	tex.needsUpdate = true;
	return tex;

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

async function updateModel() {

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

	const onFinish = async () => {

		if ( modelInfo.rotation ) {

			model.rotation.set( ...modelInfo.rotation );

		}

		if ( modelInfo.removeEmission ) {

			model.traverse( c => {

				if ( c.material ) {

					c.material.emissiveMap = null;
					c.material.emissiveIntensity = 0;

				}

			} );

		}

		model.traverse( c => {

			if ( c.material ) {

				c.material.side = DoubleSide;

			}

		} );

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

		box.setFromObject( model );

		const group = new Group();
		floorPlane.position.y = box.min.y;
		group.add( model, floorPlane );

		await viewer.setModel( group, { onProgress: v => {

			const percent = Math.floor( 100 * v );
			loadingEl.innerText = `Building BVH : ${ percent }%`;

		} } );

		loadingEl.style.visibility = 'hidden';

		creditEl.innerHTML = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		buildGui();

		viewer.pausePathTracing = false;
		viewer.renderer.domElement.style.visibility = 'visible';

	};

	const url = modelInfo.url;
	if ( /(gltf|glb)$/i.test( url ) ) {

		manager.onLoad = onFinish;
		new GLTFLoader( manager )
			.setMeshoptDecoder( MeshoptDecoder )
			.load(
				url,
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

	} else if ( /mpd$/i.test( url ) ) {

		manager.onProgress = ( url, loaded, total ) => {

			const percent = Math.floor( 100 * loaded / total );
			loadingEl.innerText = `Loading : ${ percent }%`;

		};

		const loader = new LDrawLoader( manager );
		await loader.preloadMaterials( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr' );
		loader
			.setPartsLibraryPath( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/' )
			.load(
				url,
				result => {

					model = LDrawUtils.mergeObject( result );
					model.rotation.set( Math.PI, 0, 0 );
					model.traverse( c => {

						if ( c.isLineSegments ) {

							c.visible = false;

						}

						if ( c.isMesh ) {

							c.material.roughness *= 0.01;

						}

					} );
					onFinish();

				},
			);

	}

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

updateModel();
updateEnvMap();
