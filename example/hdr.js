import {
	ACESFilmicToneMapping,
	Scene,
	EquirectangularReflectionMapping,
	WebGLRenderer,
	PerspectiveCamera,
	RGBAFormat,
	LinearSRGBColorSpace,
	FloatType,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
	DoubleSide,
	Color,
	LoadingManager,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { compress, encode, findTextureMinMax } from '@monogrid/gainmap-js/dist/encode.js';
import { encodeJPEGMetadata } from '@monogrid/gainmap-js/dist/libultrahdr.js';
import { WebGLPathTracer } from '..';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';
const CREDITS = 'Model by "nyancube" on Sketchfab';
const DESCRIPTION = window.matchMedia( '(dynamic-range: high)' ).matches ? 'HDR display supported' : 'HDR display not supported';

const MAX_SAMPLES = 150;

const params = {
	hdr: true,
	environmentIntensity: 3,
	...getScaledSettings(),
};

let pathTracer, renderer, controls;
let camera, scene;
let loader, imageEl;
let encoding = false;
let encodingId = 0;
let activeImage = false;
let currUrl = null;

init();

async function init() {

	loader = new LoaderElement();
	loader.attach( document.body );

	imageEl = document.querySelector( 'img' );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.bounces = 5;
	pathTracer.minSamples = 1;
	pathTracer.renderScale = params.renderScale;
	pathTracer.tiles.set( params.tiles, params.tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	// camera
	camera = new PerspectiveCamera( 75, 1, 0.025, 500 );
	camera.position.set( 8, 9, 24 );

	// scene
	scene = new Scene();
	scene.backgroundBlurriness = 0.1;
	scene.background = new Color( 0x111111 );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.y = 10;
	controls.addEventListener( 'change', () => {

		pathTracer.updateCamera();
		resetHdr();

	} );
	controls.update();

	// load the environment map and model
	const [ gltf, envTexture ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		new RGBELoader().loadAsync( ENV_URL ),
	] );

	const model = gltf.scene;

	// const manager = new LoadingManager();
	// const complete = new Promise( resolve => manager.onLoad = resolve );
	// const ldrawLoader = new LDrawLoader( manager );
	// await ldrawLoader.preloadMaterials( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr' );
	// let model = await ldrawLoader
	// 	.setPartsLibraryPath( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/' )
	// 	.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ldraw/officialLibrary/models/7140-1-X-wingFighter.mpd_Packed.mpd' );
	// await complete;

	// model = LDrawUtils.mergeObject( model );
	// model.rotation.set( Math.PI, 0, 0 );
	// model.scale.setScalar( 0.05 );

	envTexture.mapping = EquirectangularReflectionMapping;
	scene.environment = envTexture;
	scene.environmentIntensity = 3;
	scene.add( model );

	const floorTex = generateRadialFloorTexture( 2048 );
	const floorPlane = new Mesh(
		new PlaneGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0xffffff,
			roughness: 0.05,
			metalness: 0.9,
			side: DoubleSide,
		} ),
	);
	floorPlane.scale.setScalar( 50 );
	floorPlane.rotation.x = - Math.PI / 2;
	scene.add( floorPlane );

	// initialize the path tracer
	await pathTracer.setSceneAsync( scene, camera, {
		onProgress: v => loader.setPercentage( v ),
	} );

	loader.setPercentage( 1 );
	loader.setCredits( CREDITS );
	loader.setDescription( DESCRIPTION );

	const gui = new GUI();
	gui.add( params, 'hdr' );
	gui.add( params, 'renderScale', 0.1, 1 ).onChange( v => {

		pathTracer.renderScale = v;
		pathTracer.reset();

	} );
	gui.add( params, 'tiles', 1, 5, 1 ).onChange( v => {

		pathTracer.tiles.setScalar( v );

	} );
	gui.add( params, 'environmentIntensity', 0, 5 ).onChange( v => {

		scene.environmentIntensity = v;
		pathTracer.updateEnvironment();
		resetHdr();

	} );

	window.addEventListener( 'resize', onResize );

	onResize();
	animate();

}

function onResize() {

	// update resolution
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	// update camera
	pathTracer.updateCamera();

	resetHdr();

}

function resetHdr() {

	encodingId ++;
	if ( activeImage ) {

		activeImage = false;
		URL.revokeObjectURL( currUrl );
		imageEl.src = 'null';

	}

}

function animate() {

	requestAnimationFrame( animate );

	if ( pathTracer.samples < MAX_SAMPLES ) {

		pathTracer.renderSample();

	}

	if ( ! encoding && pathTracer.samples >= pathTracer.minSamples && params.hdr && pathTracer.samples < MAX_SAMPLES && pathTracer.samples % 1 === 0 ) {

		encodingId ++;
		encoding = true;

		const currentId = encodingId;
		const image = readRenderTargetAsImage( pathTracer.target );
		encodeHDR( image ).then( array => {

			encoding = false;
			if ( encodingId === currentId && params.hdr ) {

				if ( currUrl ) {

					URL.revokeObjectURL( currUrl );

				}

				const blob = new Blob( [ array ], { type: 'octet/stream' } );
				currUrl = URL.createObjectURL( blob );
				imageEl.src = currUrl;

				activeImage = true;
				imageEl.classList.add( 'show' );

			}

		} );

	}

	if ( activeImage && params.hdr ) {

		imageEl.classList.add( 'show' );

	} else {

		imageEl.classList.remove( 'show' );

	}

	// imageEl.style.visibility = params.hdr ? 'visible' : 'hidden';

	loader.setSamples( pathTracer.samples );

}

function readRenderTargetAsImage( target ) {

	// based on EXR file result
	// {
	// 	header: EXRHeader,
	// 	width: EXRDecoder.width,
	// 	height: EXRDecoder.height,
	// 	data: EXRDecoder.byteArray,
	// 	format: EXRDecoder.format,
	// 	colorSpace: EXRDecoder.colorSpace,
	// 	type: this.type,
	// };

	const buffer = new Float32Array( target.width * target.height * 4 );
	renderer.readRenderTargetPixels( target, 0, 0, target.width, target.height, buffer );
	return {
		header: {},
		width: target.width,
		height: target.height,
		data: buffer,
		format: RGBAFormat,
		colorSpace: LinearSRGBColorSpace,
		type: FloatType,

	};

}

async function encodeHDR( image ) {

	// find RAW RGB Max value of a texture
	const textureMax = await findTextureMinMax( image );

	// Encode the gainmap
	const encodingResult = encode( {
		image,
		// this will encode the full HDR range
		maxContentBoost: Math.max.apply( this, textureMax ) || 1
	} );

	// obtain the RAW RGBA SDR buffer and create an ImageData
	const sdrImageData = new ImageData(
		encodingResult.sdr.toArray(),
		encodingResult.sdr.width,
		encodingResult.sdr.height
	);
	// obtain the RAW RGBA Gain map buffer and create an ImageData
	const gainMapImageData = new ImageData(
		encodingResult.gainMap.toArray(),
		encodingResult.gainMap.width,
		encodingResult.gainMap.height
	);

	// parallel compress the RAW buffers into the specified mimeType
	const mimeType = 'image/jpeg';
	const quality = 0.9;

	const [ sdr, gainMap ] = await Promise.all( [
		compress( {
			source: sdrImageData,
			mimeType,
			quality,
			flipY: true // output needs to be flipped
		} ),
		compress( {
			source: gainMapImageData,
			mimeType,
			quality,
			flipY: true // output needs to be flipped
		} )
	] );

	// obtain the metadata which will be embedded into
	// and XMP tag inside the final JPEG file
	const metadata = encodingResult.getMetadata();

	// embed the compressed images + metadata into a single
	// JPEG file
	const jpegBuffer = await encodeJPEGMetadata( {
		...encodingResult,
		...metadata,
		sdr,
		gainMap
	} );

	return jpegBuffer;

}
