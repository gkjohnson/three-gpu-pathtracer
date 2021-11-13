import { ACESFilmicToneMapping, NoToneMapping, Box3, LoadingManager, EquirectangularReflectionMapping, PMREMGenerator } from 'three';
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
	resolutionScale: 1,
	tilesX: 1,
	tilesY: 1,
	environmentIntensity: 2.0,
	bounces: 3,

};
const gui = new GUI();
gui.add( params, 'acesToneMapping' ).onChange( v => {

	viewer.renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;
	viewer.fsQuad.material.needsUpdate = true;

} );
gui.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( v => {

	viewer.setScale( parseFloat( v ) );

} );
gui.add( params, 'tilesX', 1, 10, 1 ).onChange( v => {

	viewer.ptRenderer.tiles.x = parseInt( v );

} );
gui.add( params, 'tilesY', 1, 10, 1 ).onChange( v => {

	viewer.ptRenderer.tiles.y = parseInt( v );

} );
gui.add( params, 'environmentIntensity', 0.0, 50.0, 0.01 ).onChange( v => {

	viewer.ptRenderer.material.environmentIntensity = parseFloat( v );
	viewer.ptRenderer.reset();

} );
gui.add( params, 'bounces', 1, 20, 1 ).onChange( v => {

	viewer.ptRenderer.material.setDefine( 'BOUNCES', parseInt( v ) );
	viewer.ptRenderer.reset();

} );


const stats = new Stats();
document.body.appendChild( stats.dom );
viewer.renderer.physicallyCorrectLights = true;
viewer.renderer.toneMapping = ACESFilmicToneMapping;
viewer.onRender = () => {

	stats.update();
	const samples = Math.floor( viewer.ptRenderer.samples );
	const infoEl = document.getElementById( 'info' );
	infoEl.innerText = `samples: ${ samples }`;

};

function centerAndSetModel( model ) {

	const box = new Box3();
	box.setFromObject( model );
	console.log( model.position.y )
	model.position.y = - ( box.max.y - box.min.y ) / 2;
	console.log( model.position.y )

	viewer.setModel( model );

}

let model;
const manager = new LoadingManager();
manager.onLoad = () => {

	centerAndSetModel( model );

};
new GLTFLoader( manager ).load( 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Buggy/glTF/Buggy.gltf', gltf => {

	model = gltf.scene;

} );

// new LDrawLoader().load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd', model => {

// 	model.scale.setScalar( 0.001 );
// 	model.rotation.x = Math.PI;
// 	centerAndSetModel( model );

// } );

new RGBELoader( manager ).load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

	const pmremGenerator = new PMREMGenerator( viewer.renderer );
	pmremGenerator.compileCubemapShader();

	const envMap = pmremGenerator.fromEquirectangular( texture );

	texture.mapping = EquirectangularReflectionMapping;
	viewer.ptRenderer.material.environmentMap = envMap;

} );
