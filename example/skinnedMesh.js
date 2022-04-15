import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad, scene, clock, models;
let samplesEl;
let counter = 0;
const params = {

	environmentIntensity: 3,
	emissiveIntensity: 100,
	bounces: 3,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
	tiles: 1,
	autoPause: true,
	pause: false,
	continuous: false,

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.resolutionScale *= 0.5;
	params.tiles = 2;

}

init();

async function init() {

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 5.5, 3.5, 7.5 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.setDefine( 'BOUNCES', params.bounces );
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 2, - 0.08 );
	camera.lookAt( controls.target );
	controls.addEventListener( 'change', () => {

		ptRenderer.reset();

	} );
	controls.update();

	samplesEl = document.getElementById( 'samples' );

	clock = new THREE.Clock();

	const envMapPromise = new Promise( resolve => {

		new RGBELoader()
			.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr', texture => {

				const pmremGenerator = new THREE.PMREMGenerator( renderer );
				pmremGenerator.compileCubemapShader();

				const envMap = pmremGenerator.fromEquirectangular( texture );

				ptRenderer.material.environmentMap = envMap.texture;
				texture.mapping = THREE.EquirectangularReflectionMapping;
				scene.background = texture;
				scene.environment = texture;

				resolve();

			} );

	} );

	models = {};
	models.trex = await loadModel( 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/trex/scene.gltf' );
	// models.pigman = await loadModel( 'https://raw.githubusercontent.com/gkjohnson/gltf-demo-models/main/pigman/scene.gltf' );
	scene.add( models.trex.model );

	await envMapPromise;

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );

	const gui = new GUI();
	gui.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		ptRenderer.tiles.set( value, value );

	} );
	gui.add( params, 'samplesPerFrame', 1, 10, 1 );
	gui.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'environmentIntensity', 0, 10 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'bounces', 1, 5, 1 ).onChange( value => {

		ptRenderer.material.setDefine( 'BOUNCES', value );
		ptRenderer.reset();

	} );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );
	gui.add( params, 'autoPause' ).listen();
	gui.add( params, 'pause' ).onChange( v => {

		params.autoPause = false;
		setPause( v );

	} ).listen();
	gui.add( params, 'continuous' ).onChange( () => {

		params.autoPause = false;

	} );

	animate();

}

function setPause( v ) {

	models.trex.action.paused = v;
	params.pause = v;
	if ( v ) {

		regenerateScene();

	}

}

function loadModel( url ) {

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( gltf => {

			gltf.scene.traverse( c => {

				if ( c.material ) {

					c.material.metalness = 0;
					c.material.map = null;

				}

			} );

			const group = new THREE.Group();
			group.add( gltf.scene );

			const box = new THREE.Box3();
			group.updateMatrixWorld();
			box.setFromObject( gltf.scene );

			// animations
			const animations = gltf.animations;
			const mixer = new THREE.AnimationMixer( gltf.scene );

			const action = mixer.clipAction( animations[ 0 ] );
			action.play();
			action.paused = params.pause;

			const floorTex = generateRadialFloorTexture( 2048 );
			const floorPlane = new THREE.Mesh(
				new THREE.PlaneBufferGeometry(),
				new THREE.MeshStandardMaterial( {
					map: floorTex,
					transparent: true,
					color: 0xdddddd,
					roughness: 0.025,
					metalness: 1.0
				} )
			);
			floorPlane.scale.setScalar( 50 );
			floorPlane.rotation.x = - Math.PI / 2;
			floorPlane.position.y = 0.075;
			group.add( floorPlane );

			return {
				model: group,
				mixer,
				action,
			};

		} );

	return gltfPromise;

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

	const tex = new THREE.DataTexture( data, dim, dim );
	tex.format = THREE.RGBAFormat;
	tex.type = THREE.UnsignedByteType;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.needsUpdate = true;
	return tex;

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const scale = params.resolutionScale;
	const dpr = window.devicePixelRatio;

	ptRenderer.target.setSize( w * scale * dpr, h * scale * dpr );
	ptRenderer.reset();

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio * scale );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function regenerateScene() {

	const { model } = models.trex;
	const ptGenerator = new PathTracingSceneGenerator();
	ptGenerator.synchronous = true;

	const result = ptGenerator.generate( model );
	sceneInfo = result;

	const { bvh, textures, materials } = result;
	const geometry = bvh.geometry;
	const material = ptRenderer.material;

	material.bvh.updateFrom( bvh );
	material.normalAttribute.updateFrom( geometry.attributes.normal );
	material.tangentAttribute.updateFrom( geometry.attributes.tangent );
	material.uvAttribute.updateFrom( geometry.attributes.uv );
	material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
	material.textures.setTextures( renderer, 2048, 2048, textures );
	material.materials.updateFrom( materials, textures );
	material.setDefine( 'MATERIAL_LENGTH', materials.length );

	ptGenerator.dispose();
	ptRenderer.reset();

}

function animate() {

	requestAnimationFrame( animate );

	const delta = Math.min( clock.getDelta(), 30 * 0.001 );
	for ( const key in models ) {

		models[ key ].mixer.update( delta );
		models[ key ].model.updateMatrixWorld();

	}

	if ( params.autoPause ) {

		counter += delta;
		if ( ! params.pause && counter >= 2.5 || params.pause && counter >= 5 ) {

			setPause( ! params.pause );
			counter = 0;

		}

	} else {

		counter = 0;

	}

	if ( ! params.pause && ! params.continuous ) {

		renderer.render( scene, camera );

	} else {

		if ( params.continuous ) {

			regenerateScene();

		}

		ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
		ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
		ptRenderer.material.environmentIntensity = params.environmentIntensity;
		ptRenderer.material.environmentBlur = 0.35;

		camera.updateMatrixWorld();

		for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

			ptRenderer.update();

		}

		renderer.autoClear = false;
		fsQuad.render( renderer );
		renderer.autoClear = true;

		samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

	}

}




