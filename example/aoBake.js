import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { UVGenerator } from '../src/utils/UVGenerator.js';
import { AO_THICKNESS_SAMPLES_PER_UPDATE, AOThicknessMapGenerator } from '../src/utils/AOThicknessMapGenerator.js';

function replaceAll( string, find, replace ) {

	return string.split( find ).join( replace );

}

const meshphysical_frag_head = THREE.ShaderChunk[ 'meshphysical_frag' ].slice( 0, THREE.ShaderChunk[ 'meshphysical_frag' ].indexOf( 'void main() {' ) );
const meshphysical_frag_body = THREE.ShaderChunk[ 'meshphysical_frag' ].slice( THREE.ShaderChunk[ 'meshphysical_frag' ].indexOf( 'void main() {' ) );

const SubsurfaceScatteringShader = {

	name: 'SubsurfaceScatteringShader',

	uniforms: THREE.UniformsUtils.merge( [
		THREE.ShaderLib[ 'physical' ].uniforms,
		{
			'thicknessMap': { value: null },
			'thicknessColor': { value: new THREE.Color( 0xffffff ) },
			'thicknessDistortion': { value: 0.1 },
			'thicknessAmbient': { value: 0.0 },
			'thicknessAttenuation': { value: 0.1 },
			'thicknessPower': { value: 2.0 },
			'thicknessScale': { value: 10.0 },
			'subsurfaceScattering': { value: 0.1 },
			'subsurfaceRadius': { value: 0.5 },
			'subsurfaceBrightness': { value: 0.3 },
			'subsurfaceSaturation': { value: 0.6 },
		}

	] ),

	vertexShader: [
		'#define USE_UV',
		'#define USE_UV2',
		'#define USE_AOMAP',
		'#define AOMAP_UV uv2',
		'attribute vec2 uv2;',
		THREE.ShaderChunk[ 'meshphysical_vert' ]
	].join( '\n' ),

	fragmentShader: [
		'#define USE_UV',
		'#define USE_UV2',
		'#define USE_AOMAP',
		'#define AOMAP_UV uv2;',
		'#define SUBSURFACE',

		meshphysical_frag_head,

		'uniform sampler2D thicknessMap;',
		'uniform float thicknessPower;',
		'uniform float thicknessScale;',
		'uniform float thicknessDistortion;',
		'uniform float thicknessAmbient;',
		'uniform float thicknessAttenuation;',
		'uniform vec3 thicknessColor;',
		'uniform float subsurfaceRadius;',
		'uniform float subsurfaceScattering;',
		'uniform float subsurfaceBrightness;',
		'uniform float subsurfaceSaturation;',

		'vec3 adjustBrightnessAndSaturation(vec3 color, float brightness, float saturation) {',
		'  vec3 average = vec3((color.r + color.g + color.b) / 3.0);',
		'  if (saturation > 0.0) {',
		'    color += (average - color) * (1.0 - 1.0 / (1.001 - saturation));',
		'  } else {',
		'    color += (average - color) * (-saturation);',
		'  }',
		'  color += brightness;',
		'  color = clamp(color, 0.0, 1.0);',
		'  return color;',
		'}',

		'vec3 LightingSubsurface(vec3 lightDir, vec3 normalWS, vec3 subsurfaceColor, float subsurfaceRadius) {',
		'    float NdotL = dot(normalWS, lightDir);',
		'    float alpha = subsurfaceRadius;',
		'    float theta_m = acos(-alpha);',
		'    float theta = max(0.0, NdotL + alpha) - alpha;',
		'    float normalization_jgt = (2.0 + alpha) / (2.0 * (1.0 + alpha));',
		'    float wrapped_jgt = pow(((theta + alpha) / (1.0 + alpha)), 1.0 + alpha) * normalization_jgt;',
		'    return subsurfaceColor * wrapped_jgt;',
		'}',

		'void RE_Direct_Scattering(const in IncidentLight directLight, const in vec2 uv, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, inout ReflectedLight reflectedLight, const in PhysicalMaterial material) {',
		' vec3 thickness = thicknessColor * (1.0 - texture2D(thicknessMap, uv).g);',
		' vec3 scatteringHalf = normalize(directLight.direction + (geometryNormal * thicknessDistortion));',
		' float scatteringDot = pow(saturate(dot(geometryViewDir, -scatteringHalf)), thicknessPower) * thicknessScale;',
		' vec3 scatteringIllu = (scatteringDot + thicknessAmbient) * thickness;',
		' vec3 subsurfaceColor = adjustBrightnessAndSaturation(material.diffuseColor, subsurfaceBrightness, subsurfaceSaturation);',
		' vec3 translucency = scatteringIllu * thicknessAttenuation * subsurfaceColor;',
		' vec3 subsurfaceContribution = LightingSubsurface(directLight.direction, geometryNormal, subsurfaceColor, subsurfaceRadius);',
		' reflectedLight.directDiffuse += translucency;',
		' reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, subsurfaceContribution, subsurfaceScattering);',
		'}',

		meshphysical_frag_body.replace( '#include <lights_fragment_begin>',

			replaceAll(
				THREE.ShaderChunk[ 'lights_fragment_begin' ],
				'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
				[
					'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',

					'#if defined( SUBSURFACE ) && defined( USE_UV )',
					' if (subsurfaceScattering > 0.0) { RE_Direct_Scattering(directLight, vAoMapUv, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, reflectedLight, material); }',
					'#endif',
				].join( '\n' )
			),

		)

	].join( '\n' ),

};

let renderer, camera, scene, stats;
let statusEl, totalSamples = 0;
let aoGenerator, aoTexture;

const AO_THICKNESS_TEXTURE_SIZE = 1024;
const MAX_SAMPLES = 1000;

init();

function initMaterial( aoThicknessTexture ) {

	const shader = SubsurfaceScatteringShader;
	const uniforms = THREE.UniformsUtils.clone( shader.uniforms );

	uniforms[ 'diffuse' ].value = new THREE.Vector3( 1.0, 0.2, 0.2 );

	uniforms[ 'thicknessMap' ].value = aoThicknessTexture;
	uniforms[ 'thicknessColor' ].value = new THREE.Vector3( 0.5, 0.3, 0.0 );
	uniforms[ 'thicknessDistortion' ].value = 0.1;
	uniforms[ 'thicknessAmbient' ].value = 0.4;
	uniforms[ 'thicknessAttenuation' ].value = 0.8;
	uniforms[ 'thicknessPower' ].value = 2.0;
	uniforms[ 'thicknessScale' ].value = 16.0;
	uniforms[ 'subsurfaceScattering' ].value = 0.1;
	uniforms[ 'subsurfaceRadius' ].value = 0.5;
	uniforms[ 'subsurfaceBrightness' ].value = 0.3;
	uniforms[ 'subsurfaceSaturation' ].value = 0.6;
	uniforms[ 'aoMap' ].value = aoThicknessTexture;

	return new THREE.ShaderMaterial( {
		uniforms: uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		lights: true
	} );

}

async function init() {

	// initialize renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	document.body.appendChild( renderer.domElement );

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( - 4, 2, 3 );

	scene = new THREE.Scene();

	const light1 = new THREE.PointLight( 0xaaaaa, 20, 100 );
	light1.position.set( 3, 3, 3 );

	const light2 = new THREE.PointLight( 0xaaaaaa, 20, 100 );
	light2.position.set( - 3, - 3, - 3 );

	const ambientLight = new THREE.AmbientLight( 0xffffff, 2.75 );
	scene.add( ambientLight );

	scene.add( light1 );
	scene.add( light2 );

	new OrbitControls( camera, renderer.domElement );
	statusEl = document.getElementById( 'status' );

	const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf';

	const uvGenerator = new UVGenerator();
	await uvGenerator.init();

	const geometriesToBake = [];

	const aoTarget = new THREE.WebGLRenderTarget( AO_THICKNESS_TEXTURE_SIZE, AO_THICKNESS_TEXTURE_SIZE, {
		type: THREE.FloatType,
		colorSpace: THREE.LinearSRGBColorSpace,
		generateMipmaps: true,
		minFilter: THREE.NearestMipMapNearestFilter,
		magFilter: THREE.NearestFilter,
		format: THREE.RGBAFormat,
	} );

	aoGenerator = new AOThicknessMapGenerator( renderer );
	aoGenerator.samples = MAX_SAMPLES;
	aoGenerator.channel = 2;
	aoGenerator.aoRadius = 2;
	aoGenerator.thicknessRadius = 0.5;
	aoTexture = aoTarget.texture;
	const aoMaterial = initMaterial( aoTexture );
	aoMaterial.uniforms.aoMap.value = aoMaterial.uniforms.thicknessMap.value = aoTexture;

	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( url )
		.then( async gltf => {

			const group = new THREE.Group();

			// scale the scene to a reasonable size
			const box = new THREE.Box3();
			box.setFromObject( gltf.scene );

			const sphere = new THREE.Sphere();
			box.getBoundingSphere( sphere );

			gltf.scene.scale.setScalar( 2.5 / sphere.radius );
			gltf.scene.position.y = - 0.25 * ( box.max.y - box.min.y ) * 2.5 / sphere.radius;
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			group.traverse( c => {

				if ( c.isMesh ) {

					geometriesToBake.push( c.geometry );

					c.material = aoMaterial;

				}

			} );

			group.updateMatrixWorld( true );
			scene.add( group );

		} );

	await gltfPromise;

	document.getElementById( 'loading' ).remove();

	uvGenerator.channel = 2;

	uvGenerator.generate( geometriesToBake, ( item, percentage ) => {

		if ( percentage % 10 === 0 ) {

			console.log( `UV Generation: ${ percentage } % of ${ item }` );

		}

	} );

	aoGenerator.startGeneration( geometriesToBake, aoTarget );

	onResize();
	window.addEventListener( 'resize', onResize );

	stats = new Stats();
	document.body.appendChild( stats.domElement );

	animate();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function animate() {

	stats.update();

	requestAnimationFrame( animate );

	if ( aoGenerator ) {

		if ( aoGenerator.generateSample() ) {

			totalSamples += AO_THICKNESS_SAMPLES_PER_UPDATE;

		} else {

			aoGenerator = null;

		}

	}

	renderer.setRenderTarget( null );
	aoTexture.needsUpdate = true;
	renderer.render( scene, camera );

	if ( aoGenerator ) {

		statusEl.innerText = `Samples: ${ totalSamples } of ${ MAX_SAMPLES }`;


	}

}
