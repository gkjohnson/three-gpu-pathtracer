import { MeshPhysicalMaterial } from 'three';

const LDRAW_CREDIT = 'Model courtesy of the <a href="https://omr.ldraw.org/">LDraw Official Model Repository and Parts Library</a>.';
const MECABRICKS_CREDIT = 'Model courtesy of <a href="https://mecabricks.com/">MecaBricks library</a>.';
const LDRAW_MODELS_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models';

// the mecabricks exports use two dark golds that read as muddy brown when path traced
function mecaBricksGoldCorrection( model ) {

	model.traverse( c => {

		if ( c.material ) {

			if ( c.material.color.getHexString() === '7f4c0e' ) {

				c.material.color.set( 0xc2801f ).multiplyScalar( 0.9 );
				c.material.roughness = 0.45;
				c.material.metalness = 0.6;

			} else if ( c.material.color.getHexString() === '613708' ) {

				c.material.color.set( 0xc2801f );
				c.material.color.g *= 0.75;
				c.material.color.b *= 0.75;
				c.material.roughness = 0.45;
				c.material.metalness = 0.6;

			}

		}

	} );

}

// the ldraw models all share the same transparent brick handling and credit
function ldrawModel( file ) {

	return {
		opacityToTransmission: true,
		ior: 1.4,
		url: `${ LDRAW_MODELS_URL }/${ file }`,
		credit: LDRAW_CREDIT,
	};

}

export const MODEL_LIST = {

	'M2020 Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/Perseverance.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},

	'Gelatinous Cube': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/gelatinous-cube/scene.gltf',
		credit: 'Model by "glenatron" on Sketchfab.',
		rotation: [ 0, - Math.PI / 8, 0.0 ],
		opacityToTransmission: true,
		postProcess( model ) {

			const toRemove = [];
			model.traverse( c => {

				if ( c.material ) {

					if ( c.material instanceof MeshPhysicalMaterial ) {

						const material = c.material;
						material.metalness = 0.0;
						material.ior = 1.2;
						material.map = null;

						c.geometry.computeVertexNormals();

					} else if ( c.material.opacity < 1.0 ) {

						toRemove.push( c );

					}

				}

			} );

			toRemove.forEach( c => {

				c.parent.remove( c );

			} );

		}
	},

	'Octopus Tea': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/octopus-tea/scene.gltf',
		credit: 'Model by "AzTiZ" on Sketchfab.',
		opacityToTransmission: true,
		postProcess( model ) {

			const toRemove = [];

			model.updateMatrixWorld();

			model.traverse( c => {

				if ( c.material ) {

					c.material.emissiveIntensity = 0;
					if ( c.material instanceof MeshPhysicalMaterial ) {

						const material = c.material;
						material.metalness = 0.0;
						if ( material.transmission === 1.0 ) {

							material.roughness = 0.0;
							material.metalness = 0.0;

							// 29 === glass
							// 27 === liquid top
							// 23 === liquid
							if ( c.name.includes( '29' ) ) {

								material.ior = 1.52;
								material.color.set( 0xffffff );

							} else {

								material.ior = 1.2;

							}

						}

					} else if ( c.material.opacity < 1.0 ) {

						toRemove.push( c );

					}

				}

			} );

			toRemove.forEach( c => {

				c.parent.remove( c );

			} );

		}
	},

	'Halo Twist Ring': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/ring-twist-halo/scene.glb',
		credit: 'Model credit NASA / JPL-Caltech',
		opacityToTransmission: true,
		postProcess( model ) {

			model.traverse( c => {

				if ( c.material ) {

					if ( c.material instanceof MeshPhysicalMaterial ) {

						if ( c.material.transmission === 1.0 ) {

							const material = c.material;
							material.metalness = 0.0;
							material.ior = 1.8;
							material.color.set( 0xffffff );

						}

					}

				}

			} );

		}
	},

	'Flight Helmet': {
		url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf',
		credit: 'glTF Sample Model.',
	},

	'Crab Sculpture': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/threedscans/Crab.glb',
		rotation: [ - 2 * Math.PI / 4, 0, 0 ],
		credit: 'Model courtesy of threedscans.com.',
		postProcess( model ) {

			model.traverse( c => {

				if ( c.material ) c.material.color.set( 0xdddddd );

			} );

		}
	},

	'LEGO Allied Avenger': ldrawModel( '6887-1 - Allied Avenger.mpd' ),

	'LEGO Apollo 11 Lander': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mecabricks/apollo-11-lunar-lander/lunar-lander.dae',
		postProcess: mecaBricksGoldCorrection,
		credit: MECABRICKS_CREDIT,
	},

	'LEGO B-wing Starfighter': ldrawModel( '10227-1 - B-wing Starfighter.mpd' ),
	'LEGO Bennys Spaceship': ldrawModel( '70816 - Bennys Spaceship Spa_kOdSy6E.mpd' ),
	'LEGO Blizzard Baron': ldrawModel( '6879-1 - Blizzard Baron.mpd' ),
	'LEGO Ice Station Odyssey': ldrawModel( '6983-1 - Ice Station Odyssey.mpd' ),
	'LEGO Ice Tunnelator': ldrawModel( '6814-1 - Ice Tunnelator.mpd' ),

	'LEGO Lunar Vehicle': {
		opacityToTransmission: true,
		ior: 1.4,
		url: 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/ldraw/officialLibrary/models/1621-1-LunarMPVVehicle.mpd_Packed.mpd',
		rotation: [ Math.PI, - Math.PI / 2, 0 ],
		credit: LDRAW_CREDIT,
	},

	'LEGO NASA Mars Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mecabricks/nasa-mars-curiosity-rover.dae',
		postProcess: mecaBricksGoldCorrection,
		credit: MECABRICKS_CREDIT,
	},

	'LEGO Stellar Recon Voyager': ldrawModel( '6956-1 - Stellar Recon Voyager.mpd' ),
	'LEGO Super Model Building Instruction': ldrawModel( '6861-2 - Super Model Building Instruction.mpd' ),

	'LEGO UCS AT-ST': {
		opacityToTransmission: true,
		ior: 1.4,
		url: 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/ldraw/officialLibrary/models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd',
		credit: LDRAW_CREDIT,
	},

	'LEGO UCS Imperial Star Destroyer': ldrawModel( '10030-1 - Imperial Star Destroyer - UCS.mpd' ),
	'LEGO UCS Millennium Falcon': ldrawModel( '10179-1 - Millennium Falcon - UCS.mpd' ),
	'LEGO UCS TIE Interceptor': ldrawModel( '7181 - TIE Interceptor - UCS.mpd' ),
	'LEGO UCS X-wing Fighter': ldrawModel( '7191 - X-wing Fighter - UCS.mpd' ),

};
