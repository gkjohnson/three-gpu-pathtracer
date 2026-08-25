import { Box3, MeshPhysicalMaterial, Vector3 } from 'three';

const LDRAW_CREDIT = 'Model courtesy of the <a href="https://omr.ldraw.org/">LDraw Official Model Repository and Parts Library</a>.';
const MECABRICKS_CREDIT = 'Model courtesy of <a href="https://mecabricks.com/">MecaBricks library</a>.';
const LDRAW_MODELS_URL = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/models';

// Models that fake glass with a partially transparent material render as noise here, so swap those
// materials for a physical material with real transmission.
function convertOpacityToTransmission( model, ior = 1.5 ) {

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
		url: `${ LDRAW_MODELS_URL }/${ file }`,
		credit: LDRAW_CREDIT,
		postProcess: model => convertOpacityToTransmission( model, 1.4 ),
	};

}

export const MODEL_LIST = {

	// the first entry is the model shown when no "model" search parameter is provided
	'NASA JPL M2020 Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/Perseverance.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},

	'NASA JPL MER Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/MER_static.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},

	'NASA JPL Ingenuity Helicopter': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/Ingenuity.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},

	'NASA JPL InSight Lander': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/InSight.glb',
		credit: 'Model credit NASA / JPL-Caltech',
	},

	'NASA JPL Juno': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/Juno.glb',
		credit: 'Model credit NASA / JPL-Caltech',
		rotation: [ Math.PI / 6, Math.PI / 5, 0 ],
	},

	'Coffee Maker': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/bitterli-rendering-resources/coffee-maker.glb',
		credit: 'Model by "cekuhnen", from <a href="https://benedikt-bitterli.me/resources/">Benedikt Bitterli\'s rendering resources</a>.',
		rotation: [ 0, 0, 0 ],
	},

	'Dragon': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/bitterli-rendering-resources/dragon.glb',
		credit: 'Model by "Delatronic", from <a href="https://benedikt-bitterli.me/resources/">Benedikt Bitterli\'s rendering resources</a>.',
		rotation: [ 0, 0, 0 ],
		postProcess( model ) {

			// the scene is authored in arbitrary units, so the glass is tinted over a fraction of
			// the model size rather than a fixed distance
			const size = new Box3().setFromObject( model ).getSize( new Vector3() );

			const material = new MeshPhysicalMaterial();
			material.roughness = 0.15;
			material.metalness = 0;
			material.transmission = 1;
			material.ior = 1.6;
			material.thickness = 1;
			material.attenuationColor.set( 0xe8a441 );
			material.attenuationDistance = 0.1 * Math.max( size.x, size.y, size.z );

			model.traverse( c => {

				if ( c.material ) c.material = material;

			} );

		}
	},

	'Little Lamp': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/bitterli-rendering-resources/little-lamp.glb',
		credit: 'Model by "UP3D", from <a href="https://benedikt-bitterli.me/resources/">Benedikt Bitterli\'s rendering resources</a>.',
		rotation: [ 0, 0, 0 ],
	},

	'Gelatinous Cube': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/gelatinous-cube/scene.gltf',
		credit: 'Model by "glenatron" on Sketchfab.',
		rotation: [ 0, - Math.PI / 8, 0.0 ],
		postProcess( model ) {

			convertOpacityToTransmission( model );

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
		postProcess( model ) {

			convertOpacityToTransmission( model );

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
		postProcess( model ) {

			convertOpacityToTransmission( model );

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
		url: 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/ldraw/officialLibrary/models/1621-1-LunarMPVVehicle.mpd_Packed.mpd',
		rotation: [ Math.PI, - Math.PI / 2, 0 ],
		credit: LDRAW_CREDIT,
		postProcess: model => convertOpacityToTransmission( model, 1.4 ),
	},

	'LEGO NASA Mars Rover': {
		url: 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/mecabricks/nasa-mars-curiosity-rover.dae',
		postProcess: mecaBricksGoldCorrection,
		credit: MECABRICKS_CREDIT,
	},

	'LEGO Stellar Recon Voyager': ldrawModel( '6956-1 - Stellar Recon Voyager.mpd' ),
	'LEGO Super Model Building Instruction': ldrawModel( '6861-2 - Super Model Building Instruction.mpd' ),

	'LEGO UCS AT-ST': {
		url: 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/ldraw/officialLibrary/models/10174-1-ImperialAT-ST-UCS.mpd_Packed.mpd',
		credit: LDRAW_CREDIT,
		postProcess: model => convertOpacityToTransmission( model, 1.4 ),
	},

	'LEGO UCS Imperial Star Destroyer': ldrawModel( '10030-1 - Imperial Star Destroyer - UCS.mpd' ),
	'LEGO UCS Millennium Falcon': ldrawModel( '10179-1 - Millennium Falcon - UCS.mpd' ),
	'LEGO UCS TIE Interceptor': ldrawModel( '7181 - TIE Interceptor - UCS.mpd' ),
	'LEGO UCS X-wing Fighter': ldrawModel( '7191 - X-wing Fighter - UCS.mpd' ),

};
