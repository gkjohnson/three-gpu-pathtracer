import * as THREE from 'three';
import { StaticGeometryGenerator } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial } from '../src/index.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let renderer, controls, sceneInfo, ptRenderer, camera, fsQuad, scene, clock, models;
let samplesEl;
const params = {

	environmentIntensity: 0,
	environmentRotation: 0,
	emissiveIntensity: 100,
	bounces: 20,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.25,
	tiles: 2,
	pause: false,


};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.min( params.bounces, 10 );
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
	camera.position.set( 5.5, 1.5, 7.5 );

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.camera = camera;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.material.setDefine( 'BOUNCES', params.bounces );
	ptRenderer.tiles.set( params.tiles, params.tiles );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
		map: ptRenderer.target.texture,
	} ) );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.15, 0.33, - 0.08 );
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

				texture.mapping = THREE.EquirectangularReflectionMapping;
				scene.background = texture;
				scene.environment = texture;

				const pmremGenerator = new THREE.PMREMGenerator( renderer );
				pmremGenerator.compileCubemapShader();

				const envMap = pmremGenerator.fromEquirectangular( texture );

				ptRenderer.material.environmentMap = envMap.texture;
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
	gui.add( params, 'environmentIntensity', 0, 25 ).onChange( () => {

		ptRenderer.reset();

	} );
	gui.add( params, 'environmentRotation', 0, 40 ).onChange( v => {

		ptRenderer.material.environmentRotation.setFromMatrix4( new THREE.Matrix4().makeRotationY( v ) );
		ptRenderer.reset();

	} );
	gui.add( params, 'bounces', 1, 30, 1 ).onChange( value => {

		ptRenderer.material.setDefine( 'BOUNCES', value );
		ptRenderer.reset();

	} );
	gui.add( params, 'resolutionScale', 0.1, 1 ).onChange( () => {

		onResize();

	} );
	gui.add( params, 'pause' ).onChange( v => {

		models.trex.action.paused = v;

	} );

	animate();

}

function loadModel( url ) {

	// const generator = new PathTracingSceneGenerator();
	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( gltf => {

			const group = new THREE.Group();
			group.add( gltf.scene );

			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );
			group.updateMatrixWorld();

			// animations
			const animations = gltf.animations;
			const mixer = new THREE.AnimationMixer( gltf.scene );

			const action = mixer.clipAction( animations[ 0 ] );
			action.play();
			// action.paused = params.pause;

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
			floorPlane.scale.setScalar( 20 );
			floorPlane.rotation.x = - Math.PI / 2;
			floorPlane.geometry.computeTangents();
			group.add( floorPlane );

			const generator = new StaticGeometryGenerator( group );
			generator.attributes = [ 'position', 'normal', 'tangent', 'uv'];

			return {
				model: group,
				mixer,
				action,
				generator,
				staticMesh: new THREE.Mesh( new THREE.BufferGeometry(), generator.getMaterials() ),
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

	const { staticMesh, generator } = models.trex;
	generator.generate( staticMesh.geometry );

	const ptGenerator = new PathTracingSceneGenerator();
	ptGenerator.generate( staticMesh ).then( result => {

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

	} );

}

function animate() {

	requestAnimationFrame( animate );

	const delta = Math.min( clock.getDelta(), 30 );
	for ( const key in models ) {

		models[ key ].mixer.update( delta );

	}

	if ( ! params.pause ) {

		renderer.render( scene, camera );

	} else {

		console.log( 'HEREaa', ptRenderer.samples )

		if ( ptRenderer.samples === 0 ) {

			console.log( ptRenderer.sample )
			regenerateScene();

		}

		if ( ! sceneInfo ) return;

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




