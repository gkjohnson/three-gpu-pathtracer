import { ACESFilmicToneMapping, NoToneMapping, Box3, LoadingManager, EquirectangularReflectionMapping, PMREMGenerator, Sphere } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { GUI } from 'three/examples/jsm/libs/dat.gui.module.js';
import { PathTracingViewer } from '../src/classes/PathTracingViewer.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

const viewer = new PathTracingViewer();
viewer.init();
viewer.domElement.style.width = '100%';
viewer.domElement.style.height = '100%';
document.body.appendChild( viewer.domElement );

const params = {

	acesToneMapping: true,
	resolutionScale: 0.5,
	tilesX: 2,
	tilesY: 2,
	environmentIntensity: 2.0,
	environmentBlur: 0.2,

	enable: true,
	bounces: 3,

};
const gui = new GUI();
const resolutionFolder = gui.addFolder( 'resolution' );
resolutionFolder.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( v => {

	viewer.setScale( parseFloat( v ) );

} );
resolutionFolder.add( params, 'tilesX', 1, 10, 1 ).onChange( v => {

	viewer.ptRenderer.tiles.x = parseInt( v );

} );
resolutionFolder.add( params, 'tilesY', 1, 10, 1 ).onChange( v => {

	viewer.ptRenderer.tiles.y = parseInt( v );

} );
resolutionFolder.open();

const environmentFolder = gui.addFolder( 'environment' );
environmentFolder.add( params, 'environmentBlur', 0.0, 1.0, 0.01 ).onChange( v => {

	viewer.ptRenderer.material.environmentBlur = parseFloat( v );
	viewer.ptRenderer.reset();

} );
environmentFolder.add( params, 'environmentIntensity', 0.0, 50.0, 0.01 ).onChange( v => {

	viewer.ptRenderer.material.environmentIntensity = parseFloat( v );
	viewer.ptRenderer.reset();

} );
environmentFolder.open();

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

const stats = new Stats();
document.body.appendChild( stats.dom );
viewer.renderer.physicallyCorrectLights = true;
viewer.renderer.toneMapping = ACESFilmicToneMapping;
viewer.setScale( 0.5 );
viewer.ptRenderer.tiles.set( 2, 2 )
viewer.onRender = () => {

	stats.update();
	const samples = Math.floor( viewer.ptRenderer.samples );
	const infoEl = document.getElementById( 'info' );
	infoEl.innerText = `samples: ${ samples }`;

};

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

	viewer.setModel( model );

}

let model;
const manager = new LoadingManager();
manager.onLoad = () => {

	centerAndSetModel( model );

};

const modelUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';
new GLTFLoader( manager )
	.setMeshoptDecoder( MeshoptDecoder )
	.load(
		new URL( modelUrl, import.meta.url ).toString(),
		gltf => {

			model = gltf.scene;

		}
	);

// const mesh = new Mesh(
// 	new TorusKnotBufferGeometry(),
// );
// viewer.setModel( mesh );

// new LDrawLoader().load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd', result => {

// 	result.scale.setScalar( 0.001 );
// 	result.rotation.x = Math.PI;
// 	model = result;

// } );

new RGBELoader( manager ).load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

	const pmremGenerator = new PMREMGenerator( viewer.renderer );
	pmremGenerator.compileCubemapShader();

	const envMap = pmremGenerator.fromEquirectangular( texture );

	texture.mapping = EquirectangularReflectionMapping;
	viewer.ptRenderer.material.environmentMap = envMap.texture;
	viewer.scene.background = texture;
	viewer.scene.environment = texture;

} );
