import { MathUtils, MeshPhysicalMaterial, RectAreaLight } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

// TODO: this scene should technically be rendered at a 1000x smaller scale

// TEMP: local v1.1 export for testing - upload to 3d-demo-data and restore the remote url
// const ORB_SCENE_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/usd-shader-ball/usd-shaderball-scene.glb';
const ORB_SCENE_URL = new URL( '../data/standard-shader-ball.glb', import.meta.url ).href;

// Light and camera values from the StandardShaderBall v1.1 layers. USD RectLight intensity
// maps directly onto three.js' RectAreaLight intensity.
// https://github.com/usd-wg/assets/tree/main/full_assets/StandardShaderBall/layers
const LEFT_LIGHT_SIZE = 14.96;
const LEFT_LIGHT_INTENSITY = 9;
const TOP_LIGHT_SIZE = 24.36;
const TOP_LIGHT_INTENSITY = 6;
const CAMERA_FOCAL_LENGTH = 50;
const CAMERA_APERTURE = 20.955;

export class MaterialOrbSceneLoader {

	constructor( manager ) {

		this.manager = manager;

	}

	loadAsync( url = ORB_SCENE_URL, ...rest ) {

		const dracoLoader = new DRACOLoader();
		dracoLoader.setDecoderPath( DRACO_DECODER_PATH );

		return new GLTFLoader( this.manager )
			.setDRACOLoader( dracoLoader )
			.loadAsync( url, ...rest )
			.then( gltf => {

				const {
					scene,
					cameras,
				} = gltf;

				// USD RectLights emit along a different local axis than three.js' RectAreaLight
				const leftLight = new RectAreaLight( 0xffffff, LEFT_LIGHT_INTENSITY, LEFT_LIGHT_SIZE, LEFT_LIGHT_SIZE );
				leftLight.rotation.x = - Math.PI / 2;
				scene.getObjectByName( 'light' ).add( leftLight );

				for ( let i = 0; i < 4; i ++ ) {

					const light = new RectAreaLight( 0xffffff, TOP_LIGHT_INTENSITY, TOP_LIGHT_SIZE, TOP_LIGHT_SIZE );
					light.rotation.x = - Math.PI / 2;
					scene.getObjectByName( 'light' + i ).add( light );

				}

				const camera = cameras[ 0 ];
				camera.fov = 2 * Math.atan( CAMERA_APERTURE / ( 2 * CAMERA_FOCAL_LENGTH ) ) * MathUtils.RAD2DEG;
				camera.updateProjectionMatrix();

				// some objects in the scene use 16 bit float vertex colors and specify so
				// emissive colors we disable them here.
				scene.traverse( c => {

					if ( c.material ) {

						c.material.emissive.set( 0, 0, 0 );
						c.material.vertexColors = false;

					}

				} );

				const material = new MeshPhysicalMaterial();
				scene.getObjectByName( 'material_surface' ).material = material;

				return {

					material,
					camera,
					scene,

				};

			} );

	}

}
