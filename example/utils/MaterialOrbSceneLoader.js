import { MeshPhysicalMaterial, RectAreaLight } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// TODO: this scene should technically be rendered at a 1000x smaller scale

const ORB_SCENE_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/usd-shader-ball/usd-shaderball-scene.glb';
function assignWatts( light, watts ) {

	// https://github.com/will-ca/glTF-Blender-IO/blob/af9e7f06508a95425b05e485fa83681b268bbdfc/addons/io_scene_gltf2/blender/exp/gltf2_blender_gather_lights.py#L92-L97
	const PBR_WATTS_TO_LUMENS = 683;
	const area = light.width * light.height;
	const lumens = PBR_WATTS_TO_LUMENS * watts;
	light.intensity = lumens / ( area * 4 * Math.PI );

}

export class MaterialOrbSceneLoader {

	constructor( manager ) {

		this.manager = manager;

	}

	loadAsync( url = ORB_SCENE_URL, ...rest ) {

		return new GLTFLoader( this.manager )
			.loadAsync( url, ...rest )
			.then( gltf => {

				const {
					scene,
					cameras,
				} = gltf;

				const leftLight = new RectAreaLight( 0xffffff, 1, 15, 15 );
				assignWatts( leftLight, 6327.84 );
				scene.getObjectByName( 'light' ).add( leftLight );

				for ( let i = 0; i < 4; i ++ ) {

					const light = new RectAreaLight( 0xffffff, 1, 24.36, 24.36 );
					assignWatts( light, 11185.5 );
					scene.getObjectByName( 'light' + i ).add( light );

				}

				// TODO: why is this necessary?
				const camera = cameras[ 0 ];
				camera.fov *= 2.0;
				camera.updateProjectionMatrix();

				// some objects in the scene use 16 bit float vertex colors so we disable them here
				scene.traverse( c => {

					if ( c.material ) {

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
