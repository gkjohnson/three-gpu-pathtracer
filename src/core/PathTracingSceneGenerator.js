import { BufferGeometry } from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { StaticGeometryGenerator, NO_CHANGE, GEOMETRY_ADJUSTED, GEOMETRY_REBUILT } from './utils/StaticGeometryGenerator.js';
import { updateMaterialIndexAttribute } from './utils/GeometryPreparationUtils.js';

// collect the textures from the materials
function getTextures( materials ) {

	const textureSet = new Set();
	for ( let i = 0, l = materials.length; i < l; i ++ ) {

		const material = materials[ i ];
		for ( const key in material ) {

			const value = material[ key ];
			if ( value && value.isTexture ) {

				textureSet.add( value );

			}

		}

	}

	return Array.from( textureSet );

}

// collect the lights in the scene
function getLights( objects ) {

	const lights = [];
	const iesSet = new Set();
	for ( let i = 0, l = objects.length; i < l; i ++ ) {

		objects[ i ].traverse( c => {

			if ( c.visible ) {

				if (
					c.isRectAreaLight ||
					c.isSpotLight ||
					c.isPointLight ||
					c.isDirectionalLight
				) {

					lights.push( c );

					if ( c.iesMap ) {

						iesSet.add( c.iesMap );

					}

				}

			}

		} );

	}

	const iesTextures = Array.from( iesSet ).sort( ( a, b ) => {

		if ( a.uuid < b.uuid ) return 1;
		if ( a.uuid > b.uuid ) return - 1;
		return 0;

	} );

	return { lights, iesTextures };

}

export class PathTracingSceneGenerator {

	get initialized() {

		return Boolean( this.bvh );

	}

	constructor( objects ) {

		// options
		this.bvhOptions = {};
		this.attributes = [ 'position', 'normal', 'tangent', 'color', 'uv', 'uv2' ];
		this.generateBVH = true;

		// state
		this.bvh = null;
		this.geometry = new BufferGeometry();
		this.staticGeometryGenerator = new StaticGeometryGenerator( objects );
		this._bvhWorker = null;
		this._pendingGenerate = null;
		this._buildAsync = false;
		this._materialUuids = null;

	}

	setObjects( objects ) {

		this.staticGeometryGenerator.setObjects( objects );

	}

	setBVHWorker( bvhWorker ) {

		this._bvhWorker = bvhWorker;

	}

	async generateAsync( onProgress = null ) {

		if ( ! this._bvhWorker ) {

			throw new Error( 'PathTracingSceneGenerator: "setBVHWorker" must be called before "generateAsync" can be called.' );

		}

		if ( this.bvh instanceof Promise ) {

			// if a bvh is already being generated we can wait for that to finish
			// and build another with the latest data while sharing the results.
			if ( ! this._pendingGenerate ) {

				this._pendingGenerate = new Promise( async () => {

					await this.bvh;
					this._pendingGenerate = null;

					// TODO: support multiple callbacks queued?
					return this.generateAsync( onProgress );

				} );

			}

			return this._pendingGenerate;

		} else {

			this._buildAsync = true;
			const result = this.generate( onProgress );
			this._buildAsync = false;

			result.bvh = this.bvh = await result.bvh;
			return result;

		}

	}

	generate( onProgress = null ) {

		const { staticGeometryGenerator, geometry, attributes } = this;
		const objects = staticGeometryGenerator.objects;
		staticGeometryGenerator.attributes = attributes;

		// update the skeleton animations in case WebGLRenderer is not running
		// to update it.
		objects.forEach( o => {

			o.traverse( c => {

				if ( c.isSkinnedMesh && c.skeleton ) {

					c.skeleton.update();

				}

			} );

		} );

		// generate the geometry
		const result = staticGeometryGenerator.generate( geometry );
		const materials = result.materials;
		let needsMaterialIndexUpdate = result.changeType !== NO_CHANGE || this._materialUuids === null || this._materialUuids.length !== length;
		if ( ! needsMaterialIndexUpdate ) {

			for ( let i = 0, length = materials.length; i < length; i ++ ) {

				const material = materials[ i ];
				if ( material.uuid !== this._materialUuids[ i ] ) {

					needsMaterialIndexUpdate = true;
					break;

				}

			}

		}

		const textures = getTextures( materials );
		const { lights, iesTextures } = getLights( objects );
		if ( needsMaterialIndexUpdate ) {

			updateMaterialIndexAttribute( geometry, materials, materials );
			this._materialUuids = materials.map( material => material.uuid );

		}

		// only generate a new bvh if the objects used have changed
		if ( this.generateBVH ) {

			if ( this.bvh instanceof Promise ) {

				throw new Error( 'PathTracingSceneGenerator: BVH is already building asynchronously.' );

			}

			if ( result.changeType === GEOMETRY_REBUILT ) {

				const bvhOptions = {
					strategy: SAH,
					maxLeafTris: 1,
					indirect: true,
					onProgress,
					...this.bvhOptions,
				};

				if ( this._buildAsync ) {

					this.bvh = this._bvhWorker.generate( geometry, bvhOptions );

				} else {

					this.bvh = new MeshBVH( geometry, bvhOptions );

				}

			} else if ( result.changeType === GEOMETRY_ADJUSTED ) {

				this.bvh.refit();

			}

		}

		return {
			bvhChanged: result.changeType !== NO_CHANGE,
			bvh: this.bvh,
			needsMaterialIndexUpdate,
			lights,
			iesTextures,
			geometry,
			materials,
			textures,
			objects,
		};

	}

}

export class DynamicPathTracingSceneGenerator extends PathTracingSceneGenerator {

	constructor( ...args ) {

		super( ...args );
		console.warn( 'DynamicPathTracingSceneGenerator has been deprecated and renamed to "PathTracingSceneGenerator".' );

	}

}

export class PathTracingSceneWorker extends PathTracingSceneGenerator {

	constructor( ...args ) {

		super( ...args );
		console.warn( 'PathTracingSceneWorker has been deprecated and renamed to "PathTracingSceneGenerator".' );

	}

}
