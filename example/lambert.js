import { Mesh, TorusKnotBufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PathTracingViewer } from '../src/classes/PathTracingViewer.js';

const viewer = new PathTracingViewer();
const mesh = new Mesh( new TorusKnotBufferGeometry( 1, 0.3, 300, 50 ) );
viewer.init();
viewer.setModel( mesh );

new GLTFLoader().load( 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf', gltf => {

	viewer.setModel( gltf.scene );

} );

const { renderer } = viewer;
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
document.body.appendChild( renderer.domElement );

