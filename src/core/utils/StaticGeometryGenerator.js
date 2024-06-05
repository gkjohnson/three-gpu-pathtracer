import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { mergeGeometries } from './mergeGeometries.js';
import { setCommonAttributes } from './GeometryPreparationUtils.js';
import { BakedGeometry } from './BakedGeometry.js';

export const NO_CHANGE = 0;
export const GEOMETRY_ADJUSTED = 1;
export const GEOMETRY_REBUILT = 2;

// iterate over only the meshes in the provided objects
function flatTraverseMeshes( objects, cb ) {

	for ( let i = 0, l = objects.length; i < l; i ++ ) {

		const object = objects[ i ];
		object.traverseVisible( o => {

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
		for ( const key in options.attributes ) {

			target.setAttribute( options.attributes[ key ], new BufferAttribute( new Float32Array( 0 ), 4, false ) );

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

		this.objects = null;
		this.useGroups = true;
		this.applyWorldTransforms = true;
		this.generateMissingAttributes = true;
		this.overwriteIndex = true;
		this.attributes = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv2' ];
		this._intermediateGeometry = new Map();
		this._geometryMergeSets = new WeakMap();
		this._mergeOrder = [];
		this._dummyMesh = null;

		this.setObjects( objects || [] );

	}

	_getDummyMesh() {

		// return a consistent dummy mesh
		if ( ! this._dummyMesh ) {

			const dummyMaterial = new MeshBasicMaterial();
			const emptyGeometry = new BufferGeometry();
			emptyGeometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 9 ), 3 ) );
			this._dummyMesh = new Mesh( emptyGeometry, dummyMaterial );

		}

		return this._dummyMesh;

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

		if ( meshes.length === 0 ) {

			meshes.push( this._getDummyMesh() );

		}

		return meshes;

	}

	_updateIntermediateGeometries() {

		const { _intermediateGeometry } = this;

		const meshes = this._getMeshes();
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
			// if the mesh and source geometry have changed in such a way that they are no longer
			// compatible then regenerate the baked geometry from scratch
			let geom = _intermediateGeometry.get( meshKey );
			if ( ! geom || ! geom.isCompatible( mesh, this.attributes ) ) {

				if ( geom ) {

					geom.dispose();

				}

				geom = new BakedGeometry();
				_intermediateGeometry.set( meshKey, geom );

			}

			// transform the geometry into the intermediate buffer geometry, saving whether
			// or not it changed.
			if ( geom.updateFrom( mesh, convertOptions ) ) {

				// TODO: provide option for only generating the set of attributes that are present
				// and are in the attributes array
				if ( this.generateMissingAttributes ) {

					setCommonAttributes( geom, this.attributes );

				}

			}

		}

		unusedMeshKeys.forEach( key => {

			_intermediateGeometry.delete( key );

		} );

	}

	setObjects( objects ) {

		if ( Array.isArray( objects ) ) {

			this.objects = [ ...objects ];

		} else {

			this.objects = [ objects ];

		}

	}

	generate( targetGeometry = new BufferGeometry() ) {

		// track which attributes have been updated and which to skip to avoid unnecessary attribute copies
		const { useGroups, overwriteIndex, _intermediateGeometry, _geometryMergeSets } = this;

		const meshes = this._getMeshes();
		const skipAssigningAttributes = [];
		const mergeGeometry = [];
		const previousMergeInfo = _geometryMergeSets.get( targetGeometry ) || [];

		// update all the intermediate static geometry representations
		this._updateIntermediateGeometries();

		// get the list of geometries to merge
		let forceUpdate = false;
		if ( meshes.length !== previousMergeInfo.length ) {

			forceUpdate = true;

		}

		for ( let i = 0, l = meshes.length; i < l; i ++ ) {

			const mesh = meshes[ i ];
			const geom = _intermediateGeometry.get( mesh.uuid );
			mergeGeometry.push( geom );

			const info = previousMergeInfo[ i ];
			if ( ! info || info.uuid !== geom.uuid ) {

				skipAssigningAttributes.push( false );
				forceUpdate = true;

			} else if ( info.version !== geom.version ) {

				skipAssigningAttributes.push( false );

			} else {

				skipAssigningAttributes.push( true );

			}

		}

		// If we have no geometry to merge then provide an empty geometry.
		mergeGeometryList( mergeGeometry, targetGeometry, { useGroups, forceUpdate, skipAssigningAttributes, overwriteIndex } );

		// force update means the attribute buffer lengths have changed
		if ( forceUpdate ) {

			targetGeometry.dispose();

		}

		_geometryMergeSets.set( targetGeometry, mergeGeometry.map( g => ( {
			version: g.version,
			uuid: g.uuid,
		} ) ) );

		let changeType = NO_CHANGE;
		if ( forceUpdate ) changeType = GEOMETRY_REBUILT;
		else if ( skipAssigningAttributes.includes( false ) ) changeType = GEOMETRY_ADJUSTED;

		return {
			changeType,
			materials: getMaterials( meshes ),
			geometry: targetGeometry,
		};

	}

}
