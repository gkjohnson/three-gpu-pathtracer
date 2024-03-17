import { BufferAttribute, BufferGeometry } from 'three';
import { convertToStaticGeometry } from './convertToStaticGeometry.js';
import { GeometryDiff } from './GeomDiff.js';
import { mergeGeometries } from './mergeGeometries.js';

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

export class StaticGeometryGenerator {

	constructor( objects ) {

		if ( ! Array.isArray( objects ) ) {

			objects = [ objects ];

		}

		this.objects = objects;
		this.useGroups = true;
		this.applyWorldTransforms = true;
		this.attributes = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv2' ];
		this._intermediateGeometry = new Map();
		this._diffMap = new WeakMap();
		this._mergeOrder = [];

	}

	getMaterials() {

		const materials = [];
		flatTraverseMeshes( this.objects, mesh => {

			if ( Array.isArray( mesh.material ) ) {

				materials.push( ...mesh.material );

			} else {

				materials.push( mesh.material );

			}

		} );
		return materials;

	}

	generate( targetGeometry = new BufferGeometry() ) {

		// track which attributes have been updated and which to skip to avoid unnecessary attribute copies
		const skipAttributes = [];
		const { objects, useGroups, _intermediateGeometry, _diffMap, _mergeOrder } = this;
		const unusedMeshes = new Set( _intermediateGeometry.keys() );
		const mergeGeometry = [];
		const convertOptions = {
			attributes: this.attributes,
			applyWorldTransforms: this.applyWorldTransforms,
		};
		flatTraverseMeshes( objects, mesh => {

			// get the intermediate geometry object to transform data into
			unusedMeshes.delete( mesh );
			if ( ! _intermediateGeometry.has( mesh ) ) {

				_intermediateGeometry.set( mesh, new BufferGeometry() );

			}

			// transform the geometry into the intermediate buffer geometry, saving whether
			// or not it changed.
			const geom = _intermediateGeometry.get( mesh );
			const diff = _diffMap.get( mesh );
			if ( ! diff || diff.didChange( mesh ) ) {

				convertToStaticGeometry( mesh, convertOptions, geom );
				skipAttributes.push( false );

				if ( ! diff ) {

					_diffMap.set( mesh, new GeometryDiff( mesh ) );

				} else {

					diff.update();

				}

			} else {

				skipAttributes.push( true );

			}

			mergeGeometry.push( geom );

		} );

		// if we've seen that the order of geometry has changed then make sure we don't
		// skip the assignment of attributes.
		for ( let i = 0, l = mergeGeometry.length; i < l; i ++ ) {

			const newGeo = mergeGeometry[ i ];
			const oldGeo = _mergeOrder[ i ];
			if ( newGeo !== oldGeo ) {

				skipAttributes[ i ] = false;

			}

		}

		// If we have no geometry to merge then provide an empty geometry.
		if ( mergeGeometry.length === 0 ) {

			// if there are no geometries then just create a fake empty geometry to provide
			targetGeometry.setIndex( null );

			// remove all geometry
			const attrs = targetGeometry.attributes;
			for ( const key in attrs ) {

				targetGeometry.deleteAttribute( key );

			}

			// create dummy attributes
			for ( const key in this.attributes ) {

				targetGeometry.setAttribute( this.attributes[ key ], new BufferAttribute( new Float32Array( 0 ), 4, false ) );

			}

		} else {

			mergeGeometries( mergeGeometry, { useGroups, skipAttributes }, targetGeometry );

		}

		// Mark all attributes as needing an update
		for ( const key in targetGeometry.attributes ) {

			targetGeometry.attributes[ key ].needsUpdate = true;

		}

		// Remove any unused intermediate meshes
		unusedMeshes.forEach( key => {

			_intermediateGeometry.delete( key );

		} );

		this._mergeOrder = mergeGeometry;

		return targetGeometry;

	}

}
