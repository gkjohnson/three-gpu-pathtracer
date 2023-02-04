import {
	ACESFilmicToneMapping,
	Box3,
	LoadingManager,
	Sphere,
	DoubleSide,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	Group,
	MeshPhysicalMaterial,
	WebGLRenderer,
	Scene,
	MeshBasicMaterial,
	sRGBEncoding,
	CustomBlending,
	EquirectangularReflectionMapping,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { PhysicalPathTracingMaterial, QuiltPathTracingRenderer, MaterialReducer, PhysicalCamera } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import {
	LookingGlassWebXRPolyfill,
	LookingGlassConfig
} from '@lookingglass/webxr/dist/@lookingglass/webxr.js';

const ENVMAP_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models/6814-1 - Ice Tunnelator.mpd';
const MATERIALS_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr';
const PARTS_PATH = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';

const params = {

	resolutionScale: 1 / window.devicePixelRatio,
	tiles: 1,
	samplesPerFrame: 1,

	enable: true,
	bounces: 5,
	filterGlossyFactor: 0.5,
	pause: false,

};

let loadingEl, samplesEl;
let gui, stats;
let renderer, camera;
let ptRenderer, fsQuad, controls, scene;

init();

async function init() {

	const config = LookingGlassConfig;
	config.tileHeight = 512;
	config.numViews = 45;
	config.targetY = 0;
	config.targetZ = 0;
	config.targetDiam = 3;
	config.fovy = ( 14 * Math.PI ) / 180;
	new LookingGlassWebXRPolyfill();

	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.physicallyCorrectLights = true;
	renderer.xr.enabled = true;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	const aspect = window.innerWidth / window.innerHeight;
	camera = new PhysicalCamera( 60, aspect, 0.025, 500 );
	camera.position.set( - 1, 0.25, 1 ).normalize();
	camera.bokehSize = 0;

	ptRenderer = new QuiltPathTracingRenderer( renderer );
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.camera = camera;
	ptRenderer.setFromDisplayView( 1, 0.75 * 0.12065, 0.12065 );
	ptRenderer.setSize( 3360, 3360 );

	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', resetRenderer );

	new RGBELoader()
		.load( ENVMAP_URL, texture => {

			texture.mapping = EquirectangularReflectionMapping;
			scene.environment = texture;
			scene.background = texture;
			ptRenderer.material.envMapInfo.updateFrom( texture );
			ptRenderer.reset();

		} );

	let failed = false;
	const manager = new LoadingManager();
	manager.onProgress = ( url, loaded, total ) => {

		if ( failed ) {

			return;

		}

		const percent = Math.floor( 100 * loaded / total );
		loadingEl.innerText = `Loading : ${ percent }%`;

	};

	let generator;
	const loader = new LDrawLoader( manager );
	await loader.preloadMaterials( MATERIALS_URL );
	loader
		.setPartsLibraryPath( PARTS_PATH )
		.loadAsync( MODEL_URL )
		.then( result => {

			const model = LDrawUtils.mergeObject( result );
			model.rotation.set( Math.PI, 0, 0 );

			const toRemove = [];
			model.traverse( c => {

				if ( c.isLineSegments ) {

					toRemove.push( c );

				}

				if ( c.isMesh ) {

					c.material.roughness *= 0.25;

				}

			} );

			toRemove.forEach( c => {

				c.parent.remove( c );

			} );

			convertOpacityToTransmission( model, 1.4 );

			const floorTex = generateRadialFloorTexture( 2048 );
			const floorPlane = new Mesh(
				new PlaneGeometry(),
				new MeshStandardMaterial( {
					map: floorTex,
					transparent: true,
					color: 0x111111,
					roughness: 0.2,
					metalness: 0.2,
					side: DoubleSide,
				} )
			);
			floorPlane.scale.setScalar( 5 );
			floorPlane.rotation.x = - Math.PI / 2;

			// center the model
			const box = new Box3();
			box.setFromObject( model );
			model.position
				.addScaledVector( box.min, - 0.5 )
				.addScaledVector( box.max, - 0.5 );

			const sphere = new Sphere();
			box.getBoundingSphere( sphere );

			model.scale.setScalar( 0.07 / sphere.radius );
			model.position.multiplyScalar( 0.07 / sphere.radius );
			model.updateMatrixWorld();

			box.setFromObject( model );

			model.updateMatrixWorld();

			const group = new Group();
			floorPlane.position.y = box.min.y;
			group.add( model, floorPlane );
			group.updateMatrixWorld( true );

			const reducer = new MaterialReducer();
			reducer.process( group );

			generator = new PathTracingSceneWorker();
			return generator.generate( group, { onProgress: v => {

				const percent = Math.floor( 100 * v );
				loadingEl.innerText = `Building BVH : ${ percent }%`;

			} } );

		} )
		.then( result => {

			scene.add( result.scene );

			const { bvh, textures, materials } = result;
			const geometry = bvh.geometry;
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

			loadingEl.style.visibility = 'hidden';
			renderer.domElement.style.visibility = 'visible';
			ptRenderer.reset();

			renderer.setAnimationLoop( animate );

		} )
		.catch( err => {

			failed = true;
			loadingEl.innerText = 'Failed to load model. ' + err.message;

		} );

	stats = new Stats();
	document.body.appendChild( stats.dom );
	document.body.append( VRButton.createButton( renderer ) );

	onResize();
	buildGui();

	window.addEventListener( 'resize', onResize );

}

function animate() {

	if ( ! scene.environment ) {

		return;

	}

	stats.update();

	if ( ptRenderer.samples < 1.0 || ! params.enable ) {

		renderer.render( scene, camera );

	}

	if ( params.enable ) {

		const samples = Math.floor( ptRenderer.samples );
		samplesEl.innerText = `samples: ${ samples }`;

		ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
		ptRenderer.material.bounces = params.bounces;
		ptRenderer.material.physicalCamera.updateFrom( camera );

		camera.updateMatrixWorld();

		if ( ! params.pause || ptRenderer.samples < 1 ) {

			for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

				ptRenderer.update();

			}

		}

		renderer.autoClear = false;
		fsQuad.render( renderer );
		renderer.autoClear = true;

	}

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}

function resetRenderer() {

	ptRenderer.reset();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const scale = params.resolutionScale;
	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio * scale );

	const aspect = w / h;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

}

function buildGui() {

	gui = new GUI();

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	resolutionFolder.open();

}

function convertOpacityToTransmission( model, ior ) {

	model.traverse( c => {

		if ( c.material ) {

			const material = c.material;
			if ( material.opacity < 0.65 && material.opacity > 0.2 ) {

				const newMaterial = new MeshPhysicalMaterial();
				for ( const key in material ) {

					if ( key in material ) {

						if ( material[ key ] === null ) {

							continue;

						}

						if ( material[ key ].isTexture ) {

							newMaterial[ key ] = material[ key ];

						} else if ( material[ key ].copy && material[ key ].constructor === newMaterial[ key ].constructor ) {

							newMaterial[ key ].copy( material[ key ] );

						} else if ( ( typeof material[ key ] ) === 'number' ) {

							newMaterial[ key ] = material[ key ];

						}

					}

				}

				newMaterial.opacity = 1.0;
				newMaterial.transmission = 1.0;
				newMaterial.thickness = 1.0;
				newMaterial.ior = ior;

				const hsl = {};
				newMaterial.color.getHSL( hsl );
				hsl.l = Math.max( hsl.l, 0.35 );
				newMaterial.color.setHSL( hsl.h, hsl.s, hsl.l );

				c.material = newMaterial;

			}

		}

	} );

}
