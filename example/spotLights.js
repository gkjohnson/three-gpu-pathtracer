import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera, BlurredEnvMapGenerator, PhysicalSpotLight, IESLoader } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

let renderer, controls, transformControlsScene, spotLight1, lights, spotLights, spotLightHelpers, sceneInfo, ptRenderer, activeCamera, fsQuad, materials;
let perspectiveCamera, orthoCamera;
let envMap, envMapGenerator, scene;
let iesTextures;
let samplesEl;

const orthoWidth = 5;

const iesProfileURLs = [
	'https://gist.githubusercontent.com/richardassar/0241a4c03091fc61d7d727d61480f1ed/raw/780409421bf8efe6cc828314d456aa2c8803976c/108b32f07d6d38a7a6528a6d307440df.ies',
	'https://gist.githubusercontent.com/richardassar/80a5be46f3bf2e91c98cba093f60a443/raw/8650c0c019bfdb120ecc07917c97de9e86c0438d/1aec5958092c236d005093ca27ebe378.ies',
	'https://gist.githubusercontent.com/richardassar/a5f4362935b59bb8c5ea822f17b178bc/raw/bd03ff9716a0217577d5b0f91c9ee06b363b87d0/02a7562c650498ebb301153dbbf59207.ies',
	'https://gist.githubusercontent.com/richardassar/8a712f70b99da706a13f4e902b5508e9/raw/d0d469e128b5cdec23cfe1dd10854846f8a6a1c4/1a936937a49c63374e6d4fbed9252b29.ies',
	'https://gist.githubusercontent.com/richardassar/6cbb7abf80f73a2ca10d39f7d7587556/raw/a459770128719d0af76eac8076376dd4b708e834/00c6ce79e1d2cdf3a1fb491aaaa47ae0.ies'
];

const params = {

	material1: {
		color: '#ffc766',
		emissive: '#FFFFFF',
		emissiveIntensity: 0.0,
		roughness: 0.2,
		metalness: 1.0,
		ior: 1.495,
		transmission: 0.0,
		opacity: 1.0,
		matte: false,
		castShadow: true,
	},
	material2: {
		color: '#db7157',
		emissive: '#FFFFFF',
		emissiveIntensity: 0,
		roughness: 0.0,
		metalness: 0.8,
		transmission: 0.0,
		ior: 1.495,
		opacity: 1.0,
		matte: false,
		castShadow: true,
	},
	material3: {
		color: '#3465a4',
		roughness: 0.4,
		metalness: 0.4,
		matte: false,
		castShadow: false,
		receiveShadow: true
	},
	material4: {
		color: '#FFFFFF',
		emissive: '#FFFFFF',
		emissiveIntensity: 0.0,
		roughness: 0.4,
		metalness: 0.1,
		matte: false,
		castShadow: false,
		transmission: 0.0,
		opacity: 1.0,
	},

	multipleImportanceSampling: true,
	stableNoise: false,
	environmentIntensity: 0.5,
	environmentRotation: 0,
	environmentBlur: 0.0,
	backgroundBlur: 0.05,
	bounces: 3,
	samplesPerFrame: 1,
	acesToneMapping: true,
	resolutionScale: 1 / window.devicePixelRatio, // TODO: remove before commit
	transparentTraversals: 20,
	filterGlossyFactor: 0.5,
	tiles: 1,
	backgroundAlpha: 1,
	checkerboardTransparency: true,
	showTransformControls: true,
	cameraProjection: 'Perspective',
	iesProfile: - 1,
};

if ( window.location.hash.includes( 'transmission' ) ) {

	params.material1.metalness = 0.0;
	params.material1.roughness = 0.05;
	params.material1.transmission = 1.0;
	params.material1.color = '#ffffff';
	params.bounces = 10;

}

// adjust performance parameters for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.max( params.bounces, 6 );
	params.resolutionScale *= 0.5;
	params.tiles = 2;
	params.multipleImportanceSampling = false;
	params.environmentBlur = 0.35;

}

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.setClearColor( 0, 0 );
	renderer.shadowMap.enabled = true;
	//renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	document.body.appendChild( renderer.domElement );

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PhysicalCamera( 75, aspect, 0.025, 500 );
	perspectiveCamera.position.set( 16, 2, 15 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new THREE.OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 100 );
	orthoCamera.position.set( - 4, 2, 3 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.setDefine( 'TRANSPARENT_TRAVERSALS', params.transparentTraversals );
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: THREE.CustomBlending,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	controls.target.set( 16, 1, 1 );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );

	scene = new THREE.Scene();

	samplesEl = document.getElementById( 'samples' );

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const envMapPromise = new Promise( resolve => {

		new RGBELoader()
			.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

				envMap = texture;

				updateEnvBlur();
				resolve();

			} );

	} );

	transformControlsScene = new THREE.Scene();

	const generator = new PathTracingSceneWorker();
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/material-balls/material_ball_v2.glb' )
		.then( gltf => {

			const group = new THREE.Group();

			const gltfScenes = [ ];

			// objects
			gltf.scene.scale.setScalar( 0.01 );
			gltf.scene.position.x = 0;
			gltf.scene.updateMatrixWorld();
			gltf.castShadow = true;
			gltf.receiveShadow = true;
			group.add( gltf.scene );
			gltfScenes.push( gltf.scene );

			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			gltf.scene = gltf.scene.clone();
			gltf.scene.position.x += 8;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );
			gltfScenes.push( gltf.scene );

			gltf.scene = gltf.scene.clone();
			gltf.scene.position.x += 8;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );
			gltfScenes.push( gltf.scene );

			gltf.scene = gltf.scene.clone();
			gltf.scene.position.x += 8;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );
			gltfScenes.push( gltf.scene );

			gltf.scene = gltf.scene.clone();
			gltf.scene.position.x += 8;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );
			gltfScenes.push( gltf.scene );

			const floor = new THREE.Mesh(
				new THREE.CylinderBufferGeometry( 100, 100, 0.05, 200 ),
				new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.5, metalness: 0.2 } ),
			);
			floor.geometry = floor.geometry.toNonIndexed();
			floor.geometry.clearGroups();
			floor.position.y = box.min.y - 0.05;
			floor.receiveShadow = true;
			group.add( floor );

			const wall = new THREE.Mesh(
				new THREE.BoxGeometry( 100, 10, 1 ),
				new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0, metalness: 1.0 } ),
			);
			wall.castShadow = true;
			wall.receiveShadow = true;
			wall.geometry = wall.geometry.toNonIndexed();
			wall.geometry.clearGroups();
			wall.position.x = 0.0;
			wall.position.y = box.min.y + 0.05 + 5;
			wall.position.z = box.min.z - 0.5;
			group.add( wall );

			// transform controls
			let draggingSpotLight = false;

			function makeTransformControls( object ) {

				const transformControls = new TransformControls( perspectiveCamera, renderer.domElement );
				transformControls.addEventListener( 'change', () => {

					if ( draggingSpotLight ) {

						ptRenderer.reset();

					}

				} );

				transformControls.addEventListener( 'dragging-changed', ( e ) => {

					draggingSpotLight = e.value;
					return controls.enabled = ! e.value;

				} );

				transformControls.attach( object );
				transformControlsScene.add( transformControls );

			}

			// spot lights
			spotLightHelpers = [ ];
			lights = [ ];
			spotLights = [ ];
			const iesPromises = [];

			const decays = [ 0, 1.5, 0, 0.25, 0 ];
			for ( let i = 0; i < 5; ++ i ) {

				const spotLight = new PhysicalSpotLight( 0xffffff );

				const iesIndex = - 1 + i;
				if ( iesIndex !== - 1 ) {

					const iesPromise = new Promise( ( resolve, reject ) => {

						new IESLoader().load( iesProfileURLs[ iesIndex ], tex => {

							spotLight.iesTexture = tex;
							resolve( tex );

						}, null, reject );

					} );
					iesPromises.push( iesPromise );

				}

				spotLight.position.set( i * 8, 7.0, 0.005 );
				spotLight.angle = Math.PI / 8.0;
				spotLight.penumbra = 0.0;
				spotLight.decay = decays[ i ];
				spotLight.distance = 0.0;
				spotLight.intensity = 150.0;
				spotLight.radius = 0.5;

				spotLight.shadow.mapSize.width = 512;
				spotLight.shadow.mapSize.height = 512;
				spotLight.shadow.camera.near = 0.1;
				spotLight.shadow.camera.far = 10.0;
				spotLight.shadow.focus = 1.0;
				spotLight.castShadow = true;

				spotLights.push( spotLight );
				lights.push( spotLight );

				const targetObject = new THREE.Object3D();
				targetObject.position.x = i * 8.0;
				targetObject.position.y = floor.position.y + 0.05;
				targetObject.position.z = 0.05;
				targetObject.updateMatrixWorld();
				spotLight.updateMatrixWorld();
				group.add( targetObject );

				spotLight.target = targetObject;

				group.add( spotLight );

				if ( i == 0 ) {

					const spotLightHelper = new THREE.SpotLightHelper( spotLight );
					spotLight.add( spotLightHelper );
					transformControlsScene.add( spotLightHelper );

					spotLightHelpers.push( spotLightHelper );

					spotLight1 = spotLight;

					makeTransformControls( spotLight );
					makeTransformControls( targetObject );

				}

			}

			// materials
			const material1 = new THREE.MeshStandardMaterial();
			const material2 = new THREE.MeshStandardMaterial();

			gltfScenes.forEach( gltfScene => {

				gltfScene.traverse( c => {

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

			} );

			materials = [ material1, material2, floor.material, wall.material ];

			return Promise.all( [ generator.generate( group ), Promise.all( iesPromises ) ] );

		} )
		.then( ( [ result, _iesTextures ] ) => {

			iesTextures = _iesTextures;
			sceneInfo = result;

			scene.add( result.scene );

			const { bvh, textures, materials, lights, spotLights } = result;
			const geometry = bvh.geometry;
			const material = ptRenderer.material;

			material.bvh.updateFrom( bvh );
			material.normalAttribute.updateFrom( geometry.attributes.normal );
			material.tangentAttribute.updateFrom( geometry.attributes.tangent );
			material.uvAttribute.updateFrom( geometry.attributes.uv );
			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
			material.textures.setTextures( renderer, 2048, 2048, textures );
			material.materials.updateFrom( materials, textures );
			material.iesProfiles.updateFrom( renderer, iesTextures );
			material.lights.updateFrom( lights );
			material.lightCount = lights.length;
			material.spotLights.updateFrom( spotLights, iesTextures );
			material.spotLightCount = spotLights.length;

			generator.dispose();

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );

	document.getElementById( 'loading' ).remove();
	document.body.classList.add( 'checkerboard' );

	onResize();
	window.addEventListener( 'resize', onResize );
	const gui = new GUI();

	updateCamera( params.cameraProjection );

	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'acesToneMapping' ).onChange( value => {

		renderer.toneMapping = value ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
		fsQuad.material.needsUpdate = true;

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
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	ptFolder.add( params, 'transparentTraversals', 0, 40, 1 ).onChange( value => {

		ptRenderer.material.setDefine( 'TRANSPARENT_TRAVERSALS', value );
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

		ptRenderer.material.environmentRotation.setFromMatrix4( new THREE.Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	envFolder.add( params, 'environmentBlur', 0, 1 ).onChange( () => {

		updateEnvBlur();

	} );
	envFolder.add( params, 'backgroundBlur', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'backgroundAlpha', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	envFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) {

			document.body.classList.add( 'checkerboard' );

		} else {

			document.body.classList.remove( 'checkerboard' );

		}

	} );
	envFolder.add( params, 'showTransformControls' );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic' ] ).onChange( v => {

		updateCamera( v );

	} );
	cameraFolder.add( perspectiveCamera, 'focusDistance', 1, 100 ).onChange( reset );
	cameraFolder.add( perspectiveCamera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		perspectiveCamera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		reset();

	} );
	cameraFolder.add( perspectiveCamera, 'apertureRotation', 0, 12.5 ).onChange( reset );
	cameraFolder.add( perspectiveCamera, 'anamorphicRatio', 0.1, 10.0 ).onChange( reset );
	cameraFolder.add( perspectiveCamera, 'bokehSize', 0, 50 ).onChange( reset ).listen();
	cameraFolder.add( perspectiveCamera, 'fStop', 0.3, 20 ).onChange( reset ).listen();
	cameraFolder.add( perspectiveCamera, 'fov', 25, 100 ).onChange( () => {

		perspectiveCamera.updateProjectionMatrix();
		reset();

	} ).listen();

	const matFolder1 = gui.addFolder( 'Shell Material' );
	matFolder1.addColor( params.material1, 'color' ).onChange( reset );
	matFolder1.addColor( params.material1, 'emissive' ).onChange( reset );
	matFolder1.add( params.material1, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( reset );
	matFolder1.add( params.material1, 'roughness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'metalness', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'opacity', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'transmission', 0, 1 ).onChange( reset );
	matFolder1.add( params.material1, 'ior', 0.9, 3.0 ).onChange( reset );
	matFolder1.add( params.material1, 'matte' ).onChange( reset );
	matFolder1.add( params.material1, 'castShadow' ).onChange( reset );
	matFolder1.close();

	const matFolder2 = gui.addFolder( 'Ball Material' );
	matFolder2.addColor( params.material2, 'color' ).onChange( reset );
	matFolder2.addColor( params.material2, 'emissive' ).onChange( reset );
	matFolder2.add( params.material2, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( reset );
	matFolder2.add( params.material2, 'roughness', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'metalness', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'opacity', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'transmission', 0, 1 ).onChange( reset );
	matFolder2.add( params.material2, 'ior', 0.9, 3.0 ).onChange( reset );
	matFolder2.add( params.material2, 'matte' ).onChange( reset );
	matFolder2.add( params.material2, 'castShadow' ).onChange( reset );
	matFolder2.close();

	const matFolder3 = gui.addFolder( 'Floor Material' );
	matFolder3.addColor( params.material3, 'color' ).onChange( reset );
	matFolder3.add( params.material3, 'roughness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'metalness', 0, 1 ).onChange( reset );
	matFolder3.add( params.material3, 'matte' ).onChange( reset );
	matFolder3.add( params.material3, 'castShadow' ).onChange( reset );
	matFolder3.close();

	const matFolder4 = gui.addFolder( 'Wall Material' );
	matFolder4.addColor( params.material4, 'color' ).onChange( reset );
	matFolder4.add( params.material4, 'roughness', 0, 1 ).onChange( reset );
	matFolder4.add( params.material4, 'metalness', 0, 1 ).onChange( reset );
	matFolder4.add( params.material4, 'matte' ).onChange( reset );
	matFolder4.add( params.material4, 'castShadow' ).onChange( reset );
	matFolder4.addColor( params.material4, 'emissive' ).onChange( reset );
	matFolder4.add( params.material4, 'emissiveIntensity', 0.0, 50.0, 0.01 ).onChange( reset );
	matFolder4.add( params.material4, 'transmission', 0, 1 ).onChange( reset );
	matFolder4.add( params.material4, 'opacity', 0, 1 ).onChange( reset );
	matFolder4.close();

	const matFolder5 = gui.addFolder( 'Spot Light' );
	matFolder5.addColor( spotLight1, 'color' ).onChange( reset );
	matFolder5.add( spotLight1, 'intensity', 0.0, 200.0, 0.01 ).onChange( reset );
	matFolder5.add( spotLight1, 'radius', 0.0, 10.0 ).onChange( reset );
	matFolder5.add( spotLight1, 'decay', 0.0, 2.0 ).onChange( reset );
	matFolder5.add( spotLight1, 'distance', 0.0, 20.0 ).onChange( reset );
	matFolder5.add( spotLight1, 'angle', 0.0, Math.PI / 2.0 ).onChange( reset );
	matFolder5.add( spotLight1, 'penumbra', 0.0, 1.0 ).onChange( reset );
	matFolder5.add( params, 'iesProfile', - 1, iesProfileURLs.length - 1, 1 ).onChange( v => {

		spotLight1.iesTexture = v === - 1 ? null : iesTextures[ v ];
		reset();

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

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

}

function reset() {

	ptRenderer.reset();

}

function updateEnvBlur() {

	const blurredTex = envMapGenerator.generate( envMap, params.environmentBlur );
	ptRenderer.material.envMapInfo.updateFrom( blurredTex );
	scene.environment = blurredTex;
	ptRenderer.reset();

}

function updateCamera( cameraProjection ) {

	if ( cameraProjection === 'Perspective' ) {

		if ( activeCamera ) {

			perspectiveCamera.position.copy( activeCamera.position );

		}

		activeCamera = perspectiveCamera;

	} else {

		if ( activeCamera ) {

			orthoCamera.position.copy( activeCamera.position );

		}

		activeCamera = orthoCamera;

	}

	controls.object = activeCamera;
	ptRenderer.camera = activeCamera;

	controls.update();

	reset();

}

function animate() {

	requestAnimationFrame( animate );

	const m1 = materials[ 0 ];
	m1.color.set( params.material1.color ).convertSRGBToLinear();
	m1.emissive.set( params.material1.emissive ).convertSRGBToLinear();
	m1.emissiveIntensity = params.material1.emissiveIntensity;
	m1.metalness = params.material1.metalness;
	m1.roughness = params.material1.roughness;
	m1.transmission = params.material1.transmission;
	m1.ior = params.material1.ior;
	m1.opacity = params.material1.opacity;

	const m2 = materials[ 1 ];
	m2.color.set( params.material2.color ).convertSRGBToLinear();
	m2.emissive.set( params.material2.emissive ).convertSRGBToLinear();
	m2.emissiveIntensity = params.material2.emissiveIntensity;
	m2.metalness = params.material2.metalness;
	m2.roughness = params.material2.roughness;
	m2.transmission = params.material2.transmission;
	m2.ior = params.material2.ior;
	m2.opacity = params.material2.opacity;

	const m3 = materials[ 2 ];
	m3.color.set( params.material3.color ).convertSRGBToLinear();
	m3.metalness = params.material3.metalness;
	m3.roughness = params.material3.roughness;

	const m4 = materials[ 3 ];
	m4.color.set( params.material4.color ).convertSRGBToLinear();
	m4.metalness = params.material4.metalness;
	m4.roughness = params.material4.roughness;
	m4.emissive.set( params.material4.emissive ).convertSRGBToLinear();
	m4.emissiveIntensity = params.material4.emissiveIntensity;
	m4.transmission = params.material4.transmission;
	m4.opacity = params.material4.opacity;

	ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
	ptRenderer.material.materials.setMatte( 0, params.material1.matte );
	ptRenderer.material.materials.setMatte( 1, params.material2.matte );
	ptRenderer.material.materials.setMatte( 2, params.material3.matte );
	ptRenderer.material.materials.setMatte( 3, params.material4.matte );
	ptRenderer.material.materials.setCastShadow( 0, params.material1.castShadow );
	ptRenderer.material.materials.setCastShadow( 1, params.material2.castShadow );
	ptRenderer.material.materials.setCastShadow( 2, params.material3.castShadow );
	ptRenderer.material.materials.setCastShadow( 3, params.material4.castShadow );

	ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
	ptRenderer.material.environmentIntensity = params.environmentIntensity;
	ptRenderer.material.backgroundBlur = params.backgroundBlur;
	ptRenderer.material.bounces = params.bounces;
	ptRenderer.material.backgroundAlpha = params.backgroundAlpha;
	ptRenderer.material.physicalCamera.updateFrom( activeCamera );

	ptRenderer.material.lights.updateFrom( lights );
	ptRenderer.material.spotLights.updateFrom( spotLights, iesTextures );

	activeCamera.updateMatrixWorld();

	if ( params.backgroundAlpha < 1.0 ) {

		scene.background = null;

	} else {

		scene.background = scene.environment;

	}

	spotLightHelpers.forEach( spotLightHelper => {

		spotLightHelper.update();

	} );

	for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

		ptRenderer.update();

	}

	if ( ptRenderer.samples < 1 ) {

		renderer.render( scene, activeCamera );

	}

	renderer.autoClear = false;

	fsQuad.material.map = ptRenderer.target.texture;
	fsQuad.material.depthWrite = false;
	fsQuad.render( renderer );

	if ( params.showTransformControls )
		renderer.render( transformControlsScene, activeCamera );

	renderer.autoClear = true;

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}
