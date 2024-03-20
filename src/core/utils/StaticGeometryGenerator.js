import { BufferAttribute, BufferGeometry } from 'three';
import { convertToStaticGeometry } from './convertToStaticGeometry.js';
import { GeometryDiff } from './GeomDiff.js';
import { mergeGeometries } from './mergeGeometries.js';
import { setCommonAttributes } from './GeometryPreparationUtils.js';

// iterate over only the meshes in the provided objects
function flatTraverseMeshes( objects, cb ) {

	for ( let i = 0, l = objects.length; i < l; i ++ ) {

		const object = objects[ i ];
		object.traverse( o => {

			if ( o.isMesh ) {

				cb( o );

			}

		} );

	}

}

// return the set of materials used by the provided meshes
function getMaterials( meshes ) {

	const materials = [];
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		const mesh = meshes[ i ];
		if ( Array.isArray( mesh.material ) ) {

			materials.push( ...mesh.material );

		} else {

			materials.push( mesh.material );

		}

	}

	return materials;

}

function mergeGeometryList( geometries, target, options ) {

	// If we have no geometry to merge then provide an empty geometry.
	if ( geometries.length === 0 ) {

		// if there are no geometries then just create a fake empty geometry to provide
		target.setIndex( null );

		// remove all geometry
		const attrs = target.attributes;
		for ( const key in attrs ) {

			target.deleteAttribute( key );

		}

		// create dummy attributes
		for ( const key in this.attributes ) {

			target.setAttribute( this.attributes[ key ], new BufferAttribute( new Float32Array( 0 ), 4, false ) );

		}

	} else {

		mergeGeometries( geometries, options, target );

	}

	// Mark all attributes as needing an update
	for ( const key in target.attributes ) {

		target.attributes[ key ].needsUpdate = true;

	}

}

export class StaticGeometryGenerator {

	constructor( objects ) {

		if ( ! Array.isArray( objects ) ) {

			objects = [ objects ];

		}

		this.objects = objects;
		this.useGroups = true;
		this.applyWorldTransforms = true;
		this.generateMissingAttributes = true;
		this.attributes = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv2' ];
		this._intermediateGeometry = new Map();
		this._diffMap = new Map();
		this._mergeOrder = [];

	}

	_getMeshes() {

		// iterate over only the meshes in the provided objects
		const meshes = [];
		flatTraverseMeshes( this.objects, mesh => {

			meshes.push( mesh );

		} );

		// Sort the geometry so it's in a reliable order
		meshes.sort( ( a, b ) => {

			if ( a.uuid > b.uuid ) return 1;
			if ( a.uuid < b.uuid ) return - 1;
			return 0;

		} );

		return meshes;

	}

	generate( targetGeometry = new BufferGeometry() ) {

		// track which attributes have been updated and which to skip to avoid unnecessary attribute copies
		const { useGroups, _intermediateGeometry, _diffMap, _mergeOrder } = this;

		const meshes = this._getMeshes();
		const skipAssigningAttributes = [];
		const mergeGeometry = [];
		const unusedMeshKeys = new Set( _intermediateGeometry.keys() );
		const convertOptions = {
			attributes: this.attributes,
			applyWorldTransforms: this.applyWorldTransforms,
		};

		for ( let i = 0, l = meshes.length; i < l; i ++ ) {

			const mesh = meshes[ i ];
			const meshKey = mesh.uuid;
			unusedMeshKeys.delete( meshKey );

			// initialize the intermediate geometry
			if ( ! _intermediateGeometry.has( meshKey ) ) {

				_intermediateGeometry.set( meshKey, new BufferGeometry() );

			}

			// transform the geometry into the intermediate buffer geometry, saving whether
			// or not it changed.
			const geom = _intermediateGeometry.get( meshKey );
			const diff = _diffMap.get( meshKey );
			if ( ! diff || diff.didChange( mesh ) ) {

				skipAssigningAttributes.push( false );
				convertToStaticGeometry( mesh, convertOptions, geom );

				// TODO: provide option for only generating the set of attributes that are present
				// and are in the attributes array
				if ( this.generateMissingAttributes ) {

					setCommonAttributes( geom, this.attributes );

				}

				if ( ! diff ) {

					_diffMap.set( meshKey, new GeometryDiff( mesh ) );

				} else {

					diff.updateFrom( mesh );

				}

			} else {

				skipAssigningAttributes.push( true );

			}

			mergeGeometry.push( geom );

		}

		// if we've seen that the order of geometry has changed then we need to update everything
		let forceUpdate = _mergeOrder.length !== mergeGeometry.length;
		if ( ! forceUpdate ) {

			for ( let i = 0, l = mergeGeometry.length; i < l; i ++ ) {

				const newGeo = mergeGeometry[ i ];
				const oldGeo = _mergeOrder[ i ];
				if ( newGeo !== oldGeo ) {

					forceUpdate = true;
					break;

				}

			}

		}

		// If we have no geometry to merge then provide an empty geometry.
		mergeGeometryList( mergeGeometry, targetGeometry, { useGroups, forceUpdate, skipAssigningAttributes } );

		// force update means the attribute buffer lengths have changed
		if ( forceUpdate ) {

			targetGeometry.dispose();

		}

		// Remove any unused intermediate meshes
		unusedMeshKeys.forEach( key => {

			_intermediateGeometry.delete( key );
			_diffMap.delete( key );

		} );

		this._mergeOrder = mergeGeometry;

		return {
			objectsChanged: forceUpdate,
			materials: getMaterials( meshes ),
			geometry: targetGeometry,
		};

	}

}
